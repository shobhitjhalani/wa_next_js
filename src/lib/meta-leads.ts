/**
 * Meta Lead Ads: the pure parts (no database, no server-only import), shared by the service, the webhook route and
 * the tests: settings merge, webhook handshake and signature, field_data mapping, phone numbers, duplicate
 * matching, the provisioning steps (resumable) and the per-event pipeline.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cleanLocations, geoLocations, withKeys, type Question, type TargetLocation } from './meta-ad-form';
import { MetaError, getPageToken, type Graph, type MetaLead } from './meta-graph';

// ------------------------------------------------------------------ settings

export interface LeadTemplate {
  mt_campaign_name: string; mt_form_name: string; mt_questions: unknown; mt_privacy_link_text: string;
  mt_thank_you_title: string; mt_thank_you_body: string; mt_thank_you_button: string; mt_locale: string;
  mt_countries: string[]; mt_locations: unknown; mt_age_min: number; mt_age_max: number; mt_daily_budget: number;
  mt_headline: string; mt_primary_text: string; mt_cta: string; mt_special_ad_categories: string[];
}

export interface ClientConfig {
  mc_user_id: number; mc_ad_account_id: string; mc_page_id: string; mc_privacy_policy_url: string; mc_website_url: string;
  mc_image_url: string; mc_daily_budget: number | null; mc_countries: string[] | null; mc_age_min: number | null; mc_age_max: number | null;
  mc_headline: string; mc_primary_text: string; mc_cta: string; mc_special_ad_categories: string[] | null;
  mc_country_code: string; mc_assignee: number; mc_is_active: number;
  mc_questions: unknown; mc_locations: unknown;   // NULL / [] = the template's
}

export interface AdSettings {
  userId: number; clientName: string; adAccountId: string; pageId: string; privacyUrl: string; websiteUrl: string; imageUrl: string;
  dailyBudget: number; countries: string[]; locations: TargetLocation[]; ageMin: number; ageMax: number; headline: string; primaryText: string; cta: string;
  specialAdCategories: string[]; campaignName: string; formName: string; questions: unknown[]; privacyLinkText: string;
  thankYouTitle: string; thankYouBody: string; thankYouButton: string; locale: string;
}

/** "{client} · Lead Ad · {date}" → "Tata Motors · Lead Ad · 2026-11-20". */
export function fillName(pattern: string, client: string, date: Date = new Date()): string {
  const d = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return (pattern || '{client}').replaceAll('{client}', client).replaceAll('{date}', d).replace(/\s+/g, ' ').trim().slice(0, 250);
}

/** Template + client config: a client value wins when it is set (not empty / NULL). */
export function mergeSettings(t: LeadTemplate, c: ClientConfig, clientName: string, date: Date = new Date()): AdSettings {
  const text = (own: string | null | undefined, base: string) => (own && own.trim() ? own.trim() : base);
  const list = (own: string[] | null | undefined, base: string[]) => (own && own.length ? own : base);
  const act = c.mc_ad_account_id.trim();
  const ownPlaces = cleanLocations(c.mc_locations);
  const ownArea = ownPlaces.length > 0 || (c.mc_countries?.length ?? 0) > 0;
  const ownQuestions = Array.isArray(c.mc_questions) && c.mc_questions.length ? c.mc_questions : null;
  return {
    userId: c.mc_user_id, clientName,
    adAccountId: act && !act.startsWith('act_') ? `act_${act}` : act,
    pageId: c.mc_page_id.trim(),
    privacyUrl: c.mc_privacy_policy_url.trim(),
    websiteUrl: c.mc_website_url.trim(),
    imageUrl: c.mc_image_url.trim(),
    dailyBudget: c.mc_daily_budget ?? t.mt_daily_budget,
    // The target area is taken as a whole: the client's (countries and / or places) when it set either, else the template's
    ...(ownArea
      ? { countries: (c.mc_countries ?? []).map((x) => x.toUpperCase()), locations: ownPlaces }
      : { countries: t.mt_countries.map((x) => x.toUpperCase()), locations: cleanLocations(t.mt_locations) }),
    ageMin: c.mc_age_min ?? t.mt_age_min,
    ageMax: c.mc_age_max ?? t.mt_age_max,
    headline: text(c.mc_headline, t.mt_headline) || clientName,
    primaryText: text(c.mc_primary_text, t.mt_primary_text),
    cta: text(c.mc_cta, t.mt_cta) || 'SIGN_UP',
    specialAdCategories: c.mc_special_ad_categories ?? t.mt_special_ad_categories,
    campaignName: fillName(t.mt_campaign_name, clientName, date),
    formName: fillName(t.mt_form_name, clientName, date),
    questions: withKeys((ownQuestions ?? (Array.isArray(t.mt_questions) ? t.mt_questions : [])) as Question[]),
    privacyLinkText: t.mt_privacy_link_text || 'Privacy Policy',
    thankYouTitle: t.mt_thank_you_title, thankYouBody: t.mt_thank_you_body, thankYouButton: t.mt_thank_you_button || 'Visit website',
    locale: t.mt_locale || 'en_US',
  };
}

/** What is missing before an ad can be created ([] = ready). */
export function settingsProblems(s: AdSettings): string[] {
  const p: string[] = [];
  if (!/^act_\d+$/.test(s.adAccountId)) p.push('Ad account id (act_…)');
  if (!/^\d+$/.test(s.pageId)) p.push('Facebook Page id');
  if (!/^https?:\/\//.test(s.privacyUrl)) p.push('Privacy policy URL');
  if (!/^https?:\/\//.test(s.websiteUrl)) p.push('Website URL');
  if (!/^https?:\/\//.test(s.imageUrl)) p.push('Creative image');
  if (!s.primaryText) p.push('Primary text');
  if (!s.questions.length) p.push('Form questions');
  if (!(s.dailyBudget > 0)) p.push('Daily budget');
  if (!s.countries.length && !s.locations.length) p.push('Target area');
  if (!(s.ageMin >= 13 && s.ageMax <= 65 && s.ageMin <= s.ageMax)) p.push('Age range (13–65)');
  return p;
}

// ------------------------------------------------------------------ webhook

/** GET handshake: the challenge (200, text/plain) when mode = subscribe and the verify token matches, else 403. */
export function handshake(q: URLSearchParams, verifyToken: string): { status: number; body: string } {
  const mode = q.get('hub.mode') ?? q.get('hub_mode');
  const token = q.get('hub.verify_token') ?? q.get('hub_verify_token') ?? '';
  const challenge = q.get('hub.challenge') ?? q.get('hub_challenge') ?? '';
  return mode === 'subscribe' && verifyToken !== '' && safeEqual(token, verifyToken) ? { status: 200, body: challenge } : { status: 403, body: 'Forbidden' };
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(raw body, app secret), compared in constant time. */
export function validSignature(secret: string, raw: string | Uint8Array, header: string | null | undefined): boolean {
  if (!secret || !header || !header.startsWith('sha256=')) return false;
  const want = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
  return safeEqual(header.toLowerCase(), want);
}

export interface LeadgenChange { leadgen_id: string; page_id: string; form_id: string; ad_id: string; created_time: number; raw: Record<string, unknown> }

/** Every entry[].changes[] with field "leadgen". */
export function leadgenChanges(payload: unknown): LeadgenChange[] {
  const out: LeadgenChange[] = [];
  const entries = (payload as { entry?: unknown[] })?.entry;
  for (const entry of Array.isArray(entries) ? entries : []) {
    const changes = (entry as { changes?: unknown[] })?.changes;
    for (const ch of Array.isArray(changes) ? changes : []) {
      const c = ch as { field?: string; value?: Record<string, unknown> };
      const v = c?.value ?? {};
      if (c?.field !== 'leadgen' || !v.leadgen_id) continue;
      out.push({
        leadgen_id: String(v.leadgen_id), page_id: String(v.page_id ?? (entry as { id?: string }).id ?? ''),
        form_id: String(v.form_id ?? ''), ad_id: String(v.ad_id ?? ''), created_time: Number(v.created_time) || 0, raw: v,
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------ lead mapping

/** field_data [{name, values[]}] → name → first value. */
export function flattenFieldData(fieldData: MetaLead['field_data']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of Array.isArray(fieldData) ? fieldData : []) {
    if (!f?.name) continue;
    const first = (Array.isArray(f.values) ? f.values : [f.values]).find((v) => v !== null && v !== undefined && String(v).trim() !== '');
    out[String(f.name)] = first === undefined ? '' : String(first).trim();
  }
  return out;
}

/** ISO country → calling code (the countries the agency's clients advertise in; others: pass the code itself). */
export const DIAL_CODES: Record<string, string> = {
  IN: '91', US: '1', CA: '1', GB: '44', AE: '971', SA: '966', QA: '974', KW: '965', OM: '968', BH: '973', AU: '61', NZ: '64',
  SG: '65', MY: '60', NP: '977', BD: '880', LK: '94', PK: '92', ZA: '27', KE: '254', NG: '234', DE: '49', FR: '33', IT: '39',
  ES: '34', NL: '31', IE: '353', ID: '62', TH: '66', PH: '63', JP: '81', HK: '852',
};

export function dialCode(country: string): string {
  const c = country.trim().toUpperCase();
  return DIAL_CODES[c] ?? (/^\d{1,4}$/.test(c) ? c : '91');
}

/** A phone number as typed in the form → E.164 ("+919876543210"), using the client's default country; '' when not a number. */
export function toE164(raw: string, country = 'IN'): string {
  const s = String(raw ?? '').trim();
  let digits = s.replace(/\D/g, '');
  if (!digits) return '';
  if (s.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : '';
  if (digits.startsWith('00')) { digits = digits.slice(2); return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : ''; }
  const cc = dialCode(country);
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');           // trunk prefix: 09876543210
  else if (digits.startsWith(cc) && digits.length > cc.length + 7 && digits.length - cc.length >= 9) return `+${digits}`;
  const full = cc + digits;
  return digits.length >= 6 && full.length >= 8 && full.length <= 15 ? `+${full}` : '';
}

export interface MappedLead {
  name: string; firstName: string; lastName: string; email: string; phone: string; phoneE164: string; city: string;
  custom: Record<string, string>;
}

const KNOWN = new Set(['full_name', 'first_name', 'last_name', 'email', 'phone_number', 'city']);

/** Meta's standard question keys → lead fields; every other answer (custom questions) → custom. */
export function mapLead(fields: Record<string, string>, country = 'IN'): MappedLead {
  const get = (k: string) => (fields[k] ?? '').replace(/\s+/g, ' ').trim();
  let first = get('first_name');
  let last = get('last_name');
  const full = get('full_name');
  if (!first && !last && full) {
    const parts = full.split(' ');
    first = parts[0];
    last = parts.slice(1).join(' ');
  }
  const name = full || `${first} ${last}`.trim();
  const phone = get('phone_number');
  const custom: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) if (!KNOWN.has(k) && v !== '') custom[k] = v;
  return { name, firstName: first, lastName: last, email: get('email').toLowerCase(), phone, phoneE164: toE164(phone, country), city: get('city'), custom };
}

// ------------------------------------------------------------------ duplicates

export interface LeadCandidate { id: number; mobile: string; email: string }

/** Among a client's open leads, the one this enquiry belongs to: same mobile first, else same e-mail (any case). */
export function matchLead(candidates: LeadCandidate[], mobile: string, email: string): LeadCandidate | null {
  const e = email.trim().toLowerCase();
  return (mobile ? candidates.find((c) => c.mobile !== '' && c.mobile === mobile) : undefined)
    ?? (e ? candidates.find((c) => c.email !== '' && c.email.toLowerCase() === e) : undefined)
    ?? null;
}

// ------------------------------------------------------------------ provisioning

export interface AssetIds {
  subscribed: boolean; formId: string; imageHash: string; campaignId: string; adsetId: string; creativeId: string; adId: string;
}

export const PROVISION_STEPS = ['subscribe', 'form', 'image', 'campaign', 'adset', 'creative', 'ad'] as const;
export type ProvisionStep = typeof PROVISION_STEPS[number];

export interface ProvisionDeps {
  graph: Graph;
  /** Bytes of the creative image (read from the Media Library URL). */
  loadImage: (url: string) => Promise<{ bytes: Uint8Array; name: string }>;
  /** Save what was just created (called after every step, so a failed run resumes from the next one). */
  save: (patch: Partial<AssetIds> & { note?: string }) => Promise<void>;
  uploadImage: (adAccountId: string, file: { bytes: Uint8Array; name: string }) => Promise<string>;
}

/** Advantage+ audience refuses a custom age range on some accounts: retry the ad set once without it. */
function isAdvantageAgeError(e: unknown): boolean {
  return e instanceof MetaError && /advantage|age_max|age_min|age range/i.test(`${e.message} ${e.userMessage}`);
}

/**
 * Create (PAUSED) the Page subscription, lead form, campaign, ad set, creative and ad, in that order, skipping what
 * `done` already has. Throws the first error (what was created before it is already saved).
 */
export async function provision(s: AdSettings, done: AssetIds, deps: ProvisionDeps): Promise<AssetIds> {
  const ids = { ...done };
  const { graph } = deps;
  let pageToken = '';
  const pageTok = async () => (pageToken ||= await getPageToken(graph, s.pageId));

  if (!ids.subscribed) {
    await graph.post(`${s.pageId}/subscribed_apps`, { subscribed_fields: 'leadgen' }, await pageTok());
    ids.subscribed = true;
    await deps.save({ subscribed: true });
  }
  if (!ids.formId) {
    const res = await graph.post<{ id?: string }>(`${s.pageId}/leadgen_forms`, {
      name: s.formName, locale: s.locale, questions: s.questions,
      privacy_policy: { url: s.privacyUrl, link_text: s.privacyLinkText },
      follow_up_action_url: s.websiteUrl,
      thank_you_page: { title: s.thankYouTitle, body: s.thankYouBody, button_type: 'VIEW_WEBSITE', button_text: s.thankYouButton, website_url: s.websiteUrl },
    }, await pageTok());
    if (!res.id) throw new MetaError('Meta did not return a lead form id.');
    ids.formId = res.id;
    await deps.save({ formId: res.id });
  }
  if (!ids.imageHash) {
    ids.imageHash = await deps.uploadImage(s.adAccountId, await deps.loadImage(s.imageUrl));
    await deps.save({ imageHash: ids.imageHash });
  }
  if (!ids.campaignId) {
    const res = await graph.post<{ id?: string }>(`${s.adAccountId}/campaigns`, {
      name: s.campaignName, objective: 'OUTCOME_LEADS', status: 'PAUSED',
      special_ad_categories: s.specialAdCategories, is_adset_budget_sharing_enabled: false,
    });
    if (!res.id) throw new MetaError('Meta did not return a campaign id.');
    ids.campaignId = res.id;
    await deps.save({ campaignId: res.id });
  }
  if (!ids.adsetId) {
    const adset = (advantage: 0 | 1) => graph.post<{ id?: string }>(`${s.adAccountId}/adsets`, {
      name: `${s.campaignName} · Ad set`, campaign_id: ids.campaignId, daily_budget: s.dailyBudget,
      billing_event: 'IMPRESSIONS', optimization_goal: 'LEAD_GENERATION', bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      destination_type: 'ON_AD', promoted_object: { page_id: s.pageId },
      targeting: { geo_locations: geoLocations(s.countries, s.locations), age_min: s.ageMin, age_max: s.ageMax, targeting_automation: { advantage_audience: advantage } },
      status: 'PAUSED',
    });
    let res: { id?: string };
    let note = '';
    try {
      res = await adset(1);
    } catch (e) {
      if (!isAdvantageAgeError(e)) throw e;
      res = await adset(0);
      note = `Advantage+ audience was refused with this age range (${(e as MetaError).describe()}), so the ad set was created with it off.`;
    }
    if (!res.id) throw new MetaError('Meta did not return an ad set id.');
    ids.adsetId = res.id;
    await deps.save({ adsetId: res.id, ...(note ? { note } : {}) });
  }
  if (!ids.creativeId) {
    const res = await graph.post<{ id?: string }>(`${s.adAccountId}/adcreatives`, {
      name: `${s.campaignName} · Creative`,
      object_story_spec: {
        page_id: s.pageId,
        link_data: {
          message: s.primaryText, name: s.headline, link: s.websiteUrl, image_hash: ids.imageHash,
          call_to_action: { type: s.cta, value: { lead_gen_form_id: ids.formId } },
        },
      },
    });
    if (!res.id) throw new MetaError('Meta did not return a creative id.');
    ids.creativeId = res.id;
    await deps.save({ creativeId: res.id });
  }
  if (!ids.adId) {
    const res = await graph.post<{ id?: string }>(`${s.adAccountId}/ads`, {
      name: `${s.campaignName} · Ad`, adset_id: ids.adsetId, creative: { creative_id: ids.creativeId }, status: 'PAUSED',
    });
    if (!res.id) throw new MetaError('Meta did not return an ad id.');
    ids.adId = res.id;
    await deps.save({ adId: res.id });
  }
  return ids;
}

/** Set the campaign, ad set and ad ACTIVE (after the user confirmed). */
export async function activate(graph: Graph, ids: Pick<AssetIds, 'campaignId' | 'adsetId' | 'adId'>): Promise<void> {
  for (const id of [ids.campaignId, ids.adsetId, ids.adId]) {
    if (!id) throw new MetaError('The ad is not complete yet: create it first.');
    await graph.post(id, { status: 'ACTIVE' });
  }
}

// ------------------------------------------------------------------ one leadgen event → CRM lead

export interface LeadClient {
  userId: number; country: string; assignee: number;
  /** Only leads of ads in these ad accounts (ids without "act_"); empty / missing = every lead of the Page. */
  adAccounts?: string[];
}

/** "act_123" / "123" → "123". */
export const adAccountId = (v: unknown) => String(v ?? '').trim().replace(/^act_/, '');

export interface SaveInput {
  userId: number; lead: MappedLead; meta: {
    leadgenId: string; pageId: string; formId: string; formName: string; adId: string; adName: string; campaignId: string; campaignName: string;
    platform: string; createdTime: string; isOrganic: boolean;
  };
  assignee: number; activity: string;
}

export interface EventDeps {
  clientForPage: (pageId: string) => Promise<LeadClient | null>;
  fetchLead: (leadgenId: string, pageId: string) => Promise<MetaLead>;
  formName: (formId: string, pageId: string) => Promise<string>;
  saveLead: (input: SaveInput) => Promise<{ id: number; duplicate: boolean }>;
  /** Ad account id of an ad ('' when the token can't read the ad: not one of ours). Needed with LeadClient.adAccounts. */
  adAccountOf?: (adId: string) => Promise<string>;
}

export type EventResult = { status: 'synced'; leadId: number; duplicate: boolean; userId: number } | { status: 'ignored'; reason: string }
  | { status: 'filtered'; reason: string };

/** Resolve the client, read the lead from Meta, map it and save it (the caller records the result / failure). */
export async function processLeadgen(ev: { leadgen_id: string; page_id: string; form_id: string }, deps: EventDeps): Promise<EventResult> {
  const client = await deps.clientForPage(ev.page_id);
  if (!client) return { status: 'ignored', reason: `No client is assigned to Page ${ev.page_id} (Meta Lead Ads → Lead Pages).` };
  const data = await deps.fetchLead(ev.leadgen_id, ev.page_id);
  // Page shared with the client's own ads: only leads of our ad account(s)
  const accounts = (client.adAccounts ?? []).map(adAccountId).filter(Boolean);
  if (accounts.length) {
    const adId = String(data.ad_id ?? '');
    if (!adId) return { status: 'filtered', reason: 'Organic lead (not from an ad).' };
    const account = adAccountId(deps.adAccountOf ? await deps.adAccountOf(adId) : '');
    if (!accounts.includes(account)) return { status: 'filtered', reason: `Ad ${adId} is ${account ? `in ad account ${account}` : 'in an ad account we cannot read'}, not a chosen one.` };
  }
  const lead = mapLead(flattenFieldData(data.field_data), client.country);
  const formId = String(data.form_id || ev.form_id || '');
  const formName = formId ? await deps.formName(formId, ev.page_id).catch(() => '') : '';
  const adName = String(data.ad_name ?? '');
  const res = await deps.saveLead({
    userId: client.userId, lead, assignee: client.assignee,
    activity: `Lead from Meta form ${formName || formId || '(unknown form)'}${adName ? ` via ad ${adName}` : data.is_organic ? ' (organic, not from an ad)' : ''}`,
    meta: {
      leadgenId: ev.leadgen_id, pageId: ev.page_id, formId, formName, adId: String(data.ad_id ?? ''), adName,
      campaignId: String(data.campaign_id ?? ''), campaignName: String(data.campaign_name ?? ''),
      platform: data.platform === 'ig' ? 'ig' : 'fb', createdTime: String(data.created_time ?? ''), isOrganic: !!data.is_organic,
    },
  });
  return { status: 'synced', leadId: res.id, duplicate: res.duplicate, userId: client.userId };
}

/** Seconds to wait before the next try after `attempts` failures; null = give up (5 tries in total). */
export function retryDelay(attempts: number): number | null {
  const delays = [60, 300, 900, 3600];
  return attempts >= 5 ? null : delays[Math.min(attempts - 1, delays.length - 1)] ?? 60;
}

// ------------------------------------------------------------------ Ads Manager links

export function adsManagerLinks(act: string, ids: { campaignId?: string; adsetId?: string; adId?: string; formId?: string; pageId?: string }) {
  const a = act.replace(/^act_/, '');
  const base = 'https://adsmanager.facebook.com/adsmanager/manage';
  return {
    campaign: ids.campaignId ? `${base}/campaigns?act=${a}&selected_campaign_ids=${ids.campaignId}` : '',
    adset: ids.adsetId ? `${base}/adsets?act=${a}&selected_adset_ids=${ids.adsetId}` : '',
    ad: ids.adId ? `${base}/ads?act=${a}&selected_ad_ids=${ids.adId}` : '',
    form: ids.pageId ? `https://business.facebook.com/latest/instant_forms/forms?asset_id=${ids.pageId}` : '',
  };
}
