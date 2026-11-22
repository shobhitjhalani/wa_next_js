import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config, url } from '../config';
import { exec, insert, one, query, tx, type Queryable } from '../db';
import { matchLead } from '../meta-leads';
import { CRM_LIMITS, LEAD_STATUS, normalizeSource, OPEN_STATUSES, sourceInfo } from '../crm';
import { normalizePhone } from '../phone';
import { randomString } from '../text';
import { now, phpDate } from '../time';
import { sendMail } from './mailer';

/**
 * Leads CRM: saving leads (from the panel, the webhook or Facebook Lead Ads), the per-account
 * settings and the follow-up reminder e-mails (worker job "crm-reminders").
 */

export interface CrmSettings {
  cs_user_id: number; cs_key: string; cs_verify_token: string; cs_fb_app_secret: string; cs_fb_page_token: string;
  cs_fb_page_id: string; cs_fb_page_name: string; cs_remind_email: string; cs_remind_before: number; cs_updated_on: number;
}

/** The account's CRM settings; the first call creates them (webhook key + verify token, reminders to the account e-mail). */
export async function crmSettings(userId: number): Promise<CrmSettings> {
  const row = await one<CrmSettings>('SELECT * FROM js_crm_setting WHERE cs_user_id = $1', [userId]);
  if (row) return row;
  const email = (await one<{ e: string | null }>('SELECT u_email_id AS e FROM js_user WHERE u_id = $1', [userId]))?.e ?? '';
  await exec(
    `INSERT INTO js_crm_setting (cs_user_id, cs_key, cs_verify_token, cs_remind_email, cs_updated_on) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (cs_user_id) DO NOTHING`,
    [userId, randomString(32), randomString(20), /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '', now()],
  );
  return (await one<CrmSettings>('SELECT * FROM js_crm_setting WHERE cs_user_id = $1', [userId]))!;
}

export const webhookUrl = (key: string) => url(`/api/crm/${key}`);

/** The account's own lead sources, A–Z. */
export async function customSources(userId: number): Promise<string[]> {
  return (await query<{ src_name: string }>('SELECT src_name FROM js_crm_source WHERE src_user_id = $1 ORDER BY lower(src_name)', [userId])).map((r) => r.src_name);
}

/** A source name from a form / webhook → the account's own source with that name (any case), else a built-in one. */
async function resolveSource(userId: number, raw: string | undefined): Promise<string> {
  const v = String(raw ?? '').trim();
  if (!v) return 'manual';
  const own = await one<{ src_name: string }>('SELECT src_name FROM js_crm_source WHERE src_user_id = $1 AND lower(src_name) = lower($2)', [userId, v]);
  return own ? own.src_name : normalizeSource(v);
}

export interface LeadInput {
  name?: string; mobile?: string; email?: string; source?: string; campaign?: string; notes?: string;
  fields?: Record<string, string>; externalId?: string | null; nextFollowup?: number;
  /** Also treat an open lead with the same e-mail as the same person (Meta Lead Ads). */
  matchEmail?: boolean;
  /** Team member (js_user_member id) a new lead is assigned to; an existing lead keeps its member. */
  assignedMember?: number;
  /** Meta Lead Ads details (js_crm_lead.ld_meta_*), filled on a new lead and where empty on an existing one. */
  meta?: { pageId?: string; formId: string; formName: string; adId: string; adName: string; campaignId: string; campaignName: string; platform: string; phoneE164: string };
  /** History note instead of "Lead received from ...". */
  activity?: string;
}

const clip = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Save a lead. A lead already received with the same Facebook id is not saved twice. When an open
 * lead (New / Contacted / Interested) has the same mobile, the new enquiry is added to its history
 * instead of creating a duplicate.
 */
export async function saveLead(userId: number, input: LeadInput, via: string): Promise<{ id: number; duplicate: boolean }> {
  const mobile = normalizePhone(input.mobile) ?? '';
  const source = await resolveSource(userId, input.source);
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.fields ?? {}).slice(0, CRM_LIMITS.fields)) {
    const key = clip(k, 80);
    if (key && String(v ?? '').trim()) fields[key] = String(v).trim().slice(0, CRM_LIMITS.fieldValue);
  }
  const lead = {
    name: clip(input.name, CRM_LIMITS.name), email: clip(input.email, CRM_LIMITS.email).toLowerCase(),
    campaign: clip(input.campaign, CRM_LIMITS.campaign), notes: String(input.notes ?? '').trim().slice(0, CRM_LIMITS.notes),
  };
  const t = now();

  return tx(async (db) => {
    if (input.externalId) {
      const seen = await one<{ ld_id: number }>('SELECT ld_id FROM js_crm_lead WHERE ld_user_id = $1 AND ld_external_id = $2', [userId, input.externalId], db);
      if (seen) return { id: seen.ld_id, duplicate: true };
    }
    const byEmail = !!input.matchEmail && lead.email !== '';
    if (mobile || byEmail) {
      // Same client only (ld_user_id): an open lead with this mobile, or (Meta) this e-mail
      const candidates = await query<{ ld_id: number; ld_mobile: string; ld_email: string }>(
        `SELECT ld_id, ld_mobile, ld_email FROM js_crm_lead
          WHERE ld_user_id = $1 AND ld_status = ANY($3::smallint[])
            AND (($2 <> '' AND ld_mobile = $2) OR ($4 AND ld_email <> '' AND lower(ld_email) = $5))
          ORDER BY ld_id DESC LIMIT 20 FOR UPDATE`,
        [userId, mobile, OPEN_STATUSES, byEmail, lead.email], db);
      const hit = matchLead(candidates.map((c) => ({ id: c.ld_id, mobile: c.ld_mobile, email: c.ld_email })), mobile, byEmail ? lead.email : '');
      const open = hit ? { ld_id: hit.id } : null;
      if (open) {
        const extra = [lead.campaign && `Campaign: ${lead.campaign}`, lead.notes, ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join('\n');
        const next = input.nextFollowup ?? 0;
        await insert('js_crm_followup', {
          fu_lead_id: open.ld_id, fu_user_id: userId, fu_type: 'system', fu_created_on: t, fu_next_followup: next,
          fu_note: `Enquired again via ${sourceInfo(source).label}${via ? ` (${via})` : ''}.${input.activity ? `\n${input.activity}.` : ''}${extra ? '\n' + extra : ''}`.slice(0, CRM_LIMITS.note),
        }, 'fu_id', db);
        await exec(
          `UPDATE js_crm_lead SET ld_updated_on = $2, ld_fields = CASE WHEN $8 THEN $3::jsonb || ld_fields ELSE ld_fields || $3::jsonb END,
                  ld_name = CASE WHEN ld_name = '' THEN $4 ELSE ld_name END, ld_email = CASE WHEN ld_email = '' THEN $5 ELSE ld_email END,
                  ld_next_followup = CASE WHEN $6::int > 0 THEN $6::int ELSE ld_next_followup END,
                  ld_mobile = CASE WHEN ld_mobile = '' THEN $7 ELSE ld_mobile END
            WHERE ld_id = $1`, [open.ld_id, t, JSON.stringify(fields), lead.name, lead.email, next, mobile, !!input.meta], db);
        if (input.meta || input.assignedMember) await fillMeta(open.ld_id, input, true, db);
        return { id: open.ld_id, duplicate: true };
      }
    }
    const row = await insert<{ ld_id: number }>('js_crm_lead', {
      ld_user_id: userId, ld_name: lead.name, ld_mobile: mobile, ld_email: lead.email, ld_source: source, ld_campaign: lead.campaign,
      ld_notes: lead.notes, ld_fields: JSON.stringify(fields), ld_external_id: input.externalId || null, ld_status: LEAD_STATUS.NEW,
      ld_next_followup: input.nextFollowup ?? 0, ld_created_on: t, ld_updated_on: t,
    }, 'ld_id', db);
    await insert('js_crm_followup', {
      fu_lead_id: row.ld_id, fu_user_id: userId, fu_type: 'system', fu_status: LEAD_STATUS.NEW, fu_created_on: t,
      fu_next_followup: input.nextFollowup ?? 0,
      fu_note: input.activity ? `${input.activity}.` : `Lead received from ${sourceInfo(source).label}${via ? ` (${via})` : ''}.`,
    }, 'fu_id', db);
    if (input.meta || input.assignedMember) await fillMeta(row.ld_id, input, false, db);
    return { id: row.ld_id, duplicate: false };
  });
}

/** Meta Lead Ads columns and the assigned member; on an existing lead (`onlyEmpty`) only the empty ones. */
async function fillMeta(id: number, input: LeadInput, onlyEmpty: boolean, db: Queryable): Promise<void> {
  const m = input.meta;
  const cols: [string, unknown][] = [
    ['ld_meta_page_id', m?.pageId], ['ld_meta_form_id', m?.formId], ['ld_meta_form_name', m?.formName], ['ld_meta_ad_id', m?.adId], ['ld_meta_ad_name', m?.adName],
    ['ld_meta_campaign_id', m?.campaignId], ['ld_meta_campaign_name', m?.campaignName], ['ld_platform', m?.platform], ['ld_phone_e164', m?.phoneE164],
  ];
  const sets: string[] = [];
  const args: unknown[] = [id];
  for (const [col, v] of cols) {
    if (!v) continue;
    args.push(String(v).slice(0, 300));
    sets.push(onlyEmpty ? `${col} = CASE WHEN ${col} = '' THEN $${args.length} ELSE ${col} END` : `${col} = $${args.length}`);
  }
  if (input.assignedMember) {
    args.push(input.assignedMember);
    sets.push(`ld_assigned_member = CASE WHEN ld_assigned_member = 0 THEN $${args.length}::int ELSE ld_assigned_member END`);
  }
  if (sets.length) await exec(`UPDATE js_crm_lead SET ${sets.join(', ')} WHERE ld_id = $1`, args, db);
}

// ------------------------------------------------------------------ webhook

/** Keys a form / Zapier / website usually uses for each lead field (lower-case, spaces → _). */
const NAME_KEYS = ['name', 'full_name', 'fullname', 'customer_name', 'lead_name', 'your_name', 'contact_name'];
const FIRST_KEYS = ['first_name', 'firstname', 'fname'];
const LAST_KEYS = ['last_name', 'lastname', 'lname', 'surname'];
const MOBILE_KEYS = ['mobile', 'phone', 'phone_number', 'mobile_number', 'mobile_no', 'phone_no', 'contact', 'contact_number', 'whatsapp', 'whatsapp_number', 'number', 'tel'];
const EMAIL_KEYS = ['email', 'email_address', 'e-mail', 'mail'];
const SOURCE_KEYS = ['source', 'lead_source', 'platform', 'utm_source', 'channel'];
const CAMPAIGN_KEYS = ['campaign', 'campaign_name', 'ad_name', 'adset_name', 'form_name', 'utm_campaign', 'ad'];
const NOTE_KEYS = ['message', 'notes', 'note', 'comments', 'comment', 'remarks', 'query', 'requirement', 'description'];

const keyOf = (k: string) => k.trim().toLowerCase().replace(/[\s-]+/g, '_');

/** Flatten a lead-ish object: { a: 1, b: { c: 2 } } → { a: '1', 'b.c': '2' } (values only). */
function flatten(obj: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (obj === null || obj === undefined) return out;
  if (typeof obj !== 'object') { if (prefix) out[prefix] = String(obj); return out; }
  if (Array.isArray(obj)) {
    if (obj.every((x) => x === null || typeof x !== 'object')) { if (prefix) out[prefix] = obj.join(', '); return out; }
    obj.forEach((x, i) => flatten(x, prefix ? `${prefix}.${i}` : String(i), out));
    return out;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

/** A flat key → value map (form fields, JSON, Facebook field_data) → LeadInput: known fields picked, the rest kept as fields. */
export function leadFromFields(values: Record<string, string>): LeadInput {
  const used = new Set<string>();
  const byKey = new Map(Object.entries(values).map(([k, v]) => [keyOf(k), [k, String(v ?? '').trim()] as const]));
  const pick = (keys: string[]) => {
    for (const k of keys) {
      const hit = byKey.get(k);
      if (hit && hit[1]) { used.add(hit[0]); return hit[1]; }
    }
    return '';
  };
  let name = pick(NAME_KEYS);
  const first = pick(FIRST_KEYS), last = pick(LAST_KEYS);
  if (!name) name = `${first} ${last}`.trim();
  const lead: LeadInput = {
    name, mobile: pick(MOBILE_KEYS), email: pick(EMAIL_KEYS), source: pick(SOURCE_KEYS), campaign: pick(CAMPAIGN_KEYS), notes: pick(NOTE_KEYS),
  };
  lead.fields = Object.fromEntries(Object.entries(values).filter(([k, v]) => !used.has(k) && String(v ?? '').trim()));
  return lead;
}

export class WebhookError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** Facebook's X-Hub-Signature-256 = sha256 HMAC of the raw body with the app secret. */
export function validSignature(secret: string, raw: string, header: string | null): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const want = Buffer.from(createHmac('sha256', secret).update(raw).digest('hex'));
  const got = Buffer.from(header.slice(7));
  return want.length === got.length && timingSafeEqual(want, got);
}

/**
 * A POST to /api/crm/<key>: a Facebook Lead Ads "leadgen" notification (the answers are read from
 * the Graph API with the Page token), or any JSON / form body with name, mobile, email … (website
 * forms, Zapier, Make, Pabbly, Google Ads lead forms).
 */
export async function handleCrmWebhook(s: CrmSettings, body: unknown): Promise<{ saved: number; duplicates: number; leads: number[] }> {
  const result = { saved: 0, duplicates: 0, leads: [] as number[] };
  const record = (r: { id: number; duplicate: boolean }) => { result.leads.push(r.id); if (r.duplicate) result.duplicates++; else result.saved++; };

  const b = body as Record<string, any>;
  if (b && b.object === 'page' && Array.isArray(b.entry)) {
    for (const entry of b.entry.slice(0, 50)) {
      for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
        if (change?.field !== 'leadgen' || !change.value?.leadgen_id) continue;
        record(await saveFacebookLead(s, change.value));
      }
    }
    return result;
  }

  // Generic: one lead object, { leads: [...] }, { data: {...} } or an array of leads
  const items: unknown[] = Array.isArray(body) ? body : Array.isArray(b?.leads) ? b.leads : b?.data && typeof b.data === 'object' && !Array.isArray(b.data) ? [b.data] : [body];
  for (const item of items.slice(0, 100)) {
    if (!item || typeof item !== 'object') continue;
    const lead = leadFromFields(flatten(item));
    if (!lead.mobile && !lead.email && !lead.name) continue;
    record(await saveLead(s.cs_user_id, { ...lead, source: lead.source || 'website' }, 'webhook'));
  }
  if (!result.leads.length) throw new WebhookError('No lead found: send at least a name, mobile or email.', 422);
  return result;
}

async function graphGet(path: string, token: string, params: Record<string, string> = {}): Promise<Record<string, any>> {
  const qs = new URLSearchParams({ ...params, access_token: token });
  try {
    const res = await fetch(`${config.meta.apiUrl}${path}?${qs}`, { signal: AbortSignal.timeout(20_000) });
    return await res.json();
  } catch (e) {
    return { error: { message: e instanceof Error ? e.message : String(e) } };
  }
}

/** One Lead Ads notification → a lead. Without a Page token (or when Facebook refuses) the lead is kept with a note to check it. */
async function saveFacebookLead(s: CrmSettings, v: Record<string, any>): Promise<{ id: number; duplicate: boolean }> {
  const leadgenId = String(v.leadgen_id);
  const fields: Record<string, string> = {};
  let lead: LeadInput = {};
  let problem = '';
  let source = 'facebook';
  let campaign = '';
  if (!s.cs_fb_page_token) {
    problem = 'Add the Facebook Page token in CRM Settings so the lead’s name, phone and answers are saved.';
  } else {
    let data = await graphGet(leadgenId, s.cs_fb_page_token, { fields: 'field_data,created_time,platform,form_id,ad_id,ad_name,campaign_name' });
    // ad_name / campaign_name need ads permissions; ask again without them
    if (data.error) data = await graphGet(leadgenId, s.cs_fb_page_token, { fields: 'field_data,created_time,platform,form_id,ad_id' });
    if (data.error) {
      problem = `Facebook did not return the lead’s answers: ${String(data.error.message ?? 'unknown error').slice(0, 300)}`;
    } else {
      for (const f of Array.isArray(data.field_data) ? data.field_data : []) {
        if (f?.name) fields[String(f.name)] = (Array.isArray(f.values) ? f.values : [f.values]).filter((x: unknown) => x != null).join(', ');
      }
      lead = leadFromFields(fields);
      if (data.platform === 'ig') source = 'instagram';
      campaign = String(data.campaign_name || data.ad_name || '');
      const formId = String(data.form_id || v.form_id || '');
      if (!campaign && formId) {
        const form = await graphGet(formId, s.cs_fb_page_token, { fields: 'name' });
        if (form?.name) campaign = `Form: ${form.name}`;
      }
    }
  }
  const ids = Object.fromEntries(Object.entries({ 'Facebook lead id': leadgenId, 'Form id': v.form_id, 'Ad id': v.ad_id, 'Page id': v.page_id }).filter(([, x]) => x).map(([k, x]) => [k, String(x)]));
  return saveLead(s.cs_user_id, {
    ...lead, source, campaign: campaign || lead.campaign, externalId: leadgenId,
    notes: [lead.notes, problem].filter(Boolean).join('\n'), fields: { ...lead.fields, ...ids },
  }, 'Lead Ads');
}

/** Check a Page access token and subscribe that Page to this app's leadgen webhook. */
export async function connectFacebookPage(token: string): Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }> {
  const me = await graphGet('me', token, { fields: 'id,name' });
  if (me.error || !me.id) return { ok: false, error: `Facebook refused the token: ${me.error?.message ?? 'no Page found'}` };
  let sub: Record<string, any>;
  try {
    const res = await fetch(`${config.meta.apiUrl}${me.id}/subscribed_apps`, {
      method: 'POST', signal: AbortSignal.timeout(20_000),
      body: new URLSearchParams({ subscribed_fields: 'leadgen', access_token: token }),
    });
    sub = await res.json();
  } catch (e) {
    sub = { error: { message: e instanceof Error ? e.message : String(e) } };
  }
  if (sub.error || !sub.success) return { ok: false, error: `Page “${me.name}” found, but subscribing it to leads failed: ${sub.error?.message ?? 'unknown error'}` };
  return { ok: true, id: String(me.id), name: String(me.name ?? '') };
}

// ------------------------------------------------------------------ reminders

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/**
 * E-mail each account its follow-ups that are due (cs_remind_before minutes early), once per
 * follow-up time. Follow-ups more than a day overdue are not e-mailed (they show in the panel).
 */
export async function sendCrmReminders(log: (m: string) => void = () => {}): Promise<number> {
  const t = now();
  const rows = await query<{
    ld_id: number; ld_user_id: number; ld_name: string; ld_mobile: string; ld_campaign: string; ld_source: string; ld_status: number;
    ld_next_followup: number; cs_remind_email: string; note: string | null;
  }>(
    `SELECT l.ld_id, l.ld_user_id, l.ld_name, l.ld_mobile, l.ld_campaign, l.ld_source, l.ld_status, l.ld_next_followup, s.cs_remind_email,
            (SELECT f.fu_note FROM js_crm_followup f WHERE f.fu_lead_id = l.ld_id AND f.fu_type <> 'system' ORDER BY f.fu_id DESC LIMIT 1) AS note
       FROM js_crm_lead l
       JOIN js_crm_setting s ON s.cs_user_id = l.ld_user_id AND s.cs_remind_email <> ''
       JOIN js_user u ON u.u_id = l.ld_user_id AND u.u_crm = 1
      WHERE l.ld_next_followup > 0 AND l.ld_status = ANY($2::smallint[])
        AND l.ld_reminded_on <> l.ld_next_followup
        AND l.ld_next_followup - s.cs_remind_before * 60 <= $1
        AND l.ld_next_followup > $1 - 86400
      ORDER BY l.ld_user_id, l.ld_next_followup
      LIMIT 500`, [t, OPEN_STATUSES]);
  if (!rows.length) return 0;

  const byUser = new Map<number, typeof rows>();
  for (const r of rows) byUser.set(r.ld_user_id, [...(byUser.get(r.ld_user_id) ?? []), r]);
  let sent = 0;
  for (const [userId, leads] of byUser) {
    const items = leads.map((l) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #eee"><a href="${esc(url(`/crm/${l.ld_id}`))}"><b>${esc(l.ld_name || l.ld_mobile || 'Lead #' + l.ld_id)}</b></a>
          ${l.ld_mobile ? `<br><span style="color:#555">${esc(l.ld_mobile)}</span>` : ''}${l.note ? `<br><span style="color:#777">${esc(l.note.slice(0, 160))}</span>` : ''}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;white-space:nowrap">${esc(phpDate('d M Y, h:i A', l.ld_next_followup))}</td>
        <td style="padding:8px;border-bottom:1px solid #eee">${esc(sourceInfo(l.ld_source).label)}${l.ld_campaign ? `<br><span style="color:#777">${esc(l.ld_campaign)}</span>` : ''}</td>
      </tr>`).join('');
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
      <p>${leads.length === 1 ? 'A lead follow-up is due' : `${leads.length} lead follow-ups are due`}:</p>
      <table style="border-collapse:collapse;width:100%;max-width:640px">
        <tr style="background:#f5f6f8;text-align:left"><th style="padding:8px">Lead</th><th style="padding:8px">Follow-up</th><th style="padding:8px">Source</th></tr>${items}
      </table>
      <p><a href="${esc(url('/crm?tab=due'))}">Open the follow-ups in ${esc(config.appName)}</a></p></div>`;
    try {
      await sendMail({ to: leads[0].cs_remind_email, subject: `Follow-up reminder: ${leads.length === 1 ? leads[0].ld_name || leads[0].ld_mobile || 'lead' : `${leads.length} leads`}`, html });
      sent += leads.length;
    } catch (e) {
      log(`crm reminders: mail to user ${userId} failed: ${e instanceof Error ? e.message : e}`);
    }
    // Marked even when the mail failed, so a broken mailbox doesn't get retried every minute
    await exec('UPDATE js_crm_lead SET ld_reminded_on = ld_next_followup WHERE ld_id = ANY($1::int[])', [leads.map((l) => l.ld_id)]);
  }
  log(`crm reminders: ${sent} follow-up(s) e-mailed`);
  return sent;
}
