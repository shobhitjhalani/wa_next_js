import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cleanLocations, foundLocations, geoLocations, parseLatLng, questionsProblem, withKeys } from '@/lib/meta-ad-form';
import { createGraph, MetaError, type Graph, type MetaLead } from '@/lib/meta-graph';
import {
  flattenFieldData, handshake, settingsProblems, leadgenChanges, mapLead, matchLead, mergeSettings, processLeadgen, provision, toE164, validSignature,
  type AdSettings, type AssetIds, type ClientConfig, type EventDeps, type LeadCandidate, type LeadTemplate, type SaveInput,
} from '@/lib/meta-leads';

// ------------------------------------------------------------------ fixtures

const SECRET = 'app-secret-123';
const sign = (raw: string, secret = SECRET) => 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');

const webhookBody = (leadgenId: string, pageId = '111') => JSON.stringify({
  object: 'page',
  entry: [{ id: pageId, time: 1, changes: [{ field: 'leadgen', value: { leadgen_id: leadgenId, page_id: pageId, form_id: 'F1', ad_id: 'A1', created_time: 1700000000 } }] }],
});

const metaLead = (id: string, fields: Record<string, string>, extra: Partial<MetaLead> = {}): MetaLead => ({
  id, form_id: 'F1', ad_id: 'A1', ad_name: 'Diwali ad', campaign_id: 'C1', campaign_name: 'Diwali', platform: 'fb', is_organic: false,
  field_data: Object.entries(fields).map(([name, v]) => ({ name, values: [v] })), ...extra,
});

/**
 * An in-memory CRM with the same rules as the real one: the inbox keeps a leadgen_id once (UNIQUE), a leadgen_id is
 * saved once per client, and an open lead of the same client with the same mobile or e-mail gets the enquiry instead
 * of a new lead (matchLead, the function the SQL path uses).
 */
function fakeCrm(pages: Record<string, number>) {
  const inbox = new Map<string, { status: string }>();
  const leads: { id: number; userId: number; mobile: string; email: string; externalIds: string[]; notes: string[]; name: string }[] = [];
  const deps = (leadsById: Record<string, MetaLead>): EventDeps => ({
    clientForPage: async (pageId) => (pages[pageId] ? { userId: pages[pageId], country: 'IN', assignee: 0 } : null),
    fetchLead: async (id) => leadsById[id],
    formName: async () => 'Enquiry form',
    saveLead: async (i: SaveInput) => {
      const mobile = i.lead.phoneE164.replace(/^\+91/, '');
      const own = leads.filter((l) => l.userId === i.userId);
      const seen = own.find((l) => l.externalIds.includes(i.meta.leadgenId));
      if (seen) return { id: seen.id, duplicate: true };
      const hit = matchLead(own.map<LeadCandidate>((l) => ({ id: l.id, mobile: l.mobile, email: l.email })), mobile, i.lead.email);
      if (hit) {
        const l = leads.find((x) => x.id === hit.id)!;
        l.externalIds.push(i.meta.leadgenId);
        l.notes.push(i.activity);
        if (!l.name) l.name = i.lead.name;
        return { id: l.id, duplicate: true };
      }
      const l = { id: leads.length + 1, userId: i.userId, mobile, email: i.lead.email, externalIds: [i.meta.leadgenId], notes: [i.activity], name: i.lead.name };
      leads.push(l);
      return { id: l.id, duplicate: false };
    },
  });
  /** Webhook delivery: verify, store new leadgen ids, process them. */
  const deliver = async (raw: string, header: string | null, leadsById: Record<string, MetaLead>) => {
    if (!validSignature(SECRET, raw, header)) return 401;
    for (const c of leadgenChanges(JSON.parse(raw))) {
      if (inbox.has(c.leadgen_id)) continue; // ON CONFLICT (me_leadgen_id) DO NOTHING
      inbox.set(c.leadgen_id, { status: 'received' });
      const r = await processLeadgen(c, deps(leadsById));
      inbox.set(c.leadgen_id, { status: r.status });
    }
    return 200;
  };
  return { inbox, leads, deliver, deps };
}

// ------------------------------------------------------------------ webhook

describe('webhook verify handshake', () => {
  const q = (o: Record<string, string>) => new URLSearchParams(o);
  it('returns the challenge when mode is subscribe and the token matches', () => {
    expect(handshake(q({ 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': '12345' }), 'tok')).toEqual({ status: 200, body: '12345' });
  });
  it('is 403 for a wrong token, another mode, or no configured token', () => {
    expect(handshake(q({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '1' }), 'tok').status).toBe(403);
    expect(handshake(q({ 'hub.mode': 'unsubscribe', 'hub.verify_token': 'tok', 'hub.challenge': '1' }), 'tok').status).toBe(403);
    expect(handshake(q({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '1' }), '').status).toBe(403);
  });
});

describe('X-Hub-Signature-256', () => {
  const raw = webhookBody('L1');
  it('accepts the HMAC of the raw body', () => expect(validSignature(SECRET, raw, sign(raw))).toBe(true));
  it('rejects a wrong signature, another secret or a changed body', () => {
    expect(validSignature(SECRET, raw, 'sha256=' + '0'.repeat(64))).toBe(false);
    expect(validSignature(SECRET, raw, sign(raw, 'other'))).toBe(false);
    expect(validSignature(SECRET, raw.replace('L1', 'L2'), sign(raw))).toBe(false);
    // re-serialised JSON is not the raw body
    expect(validSignature(SECRET, JSON.stringify(JSON.parse(raw), null, 1), sign(raw))).toBe(false);
  });
  it('rejects a missing header or a missing secret', () => {
    expect(validSignature(SECRET, raw, null)).toBe(false);
    expect(validSignature(SECRET, raw, '')).toBe(false);
    expect(validSignature('', raw, sign(raw, ''))).toBe(false);
  });
});

describe('leadgen pipeline', () => {
  it('a duplicate webhook delivery creates only one lead', async () => {
    const crm = fakeCrm({ 111: 7 });
    const lead = { L1: metaLead('L1', { full_name: 'Asha Verma', phone_number: '+91 98765 43210', email: 'asha@example.com' }) };
    const raw = webhookBody('L1');
    expect(await crm.deliver(raw, sign(raw), lead)).toBe(200);
    expect(await crm.deliver(raw, sign(raw), lead)).toBe(200);
    expect(crm.leads).toHaveLength(1);
    expect(crm.inbox.size).toBe(1);
    expect(crm.leads[0].notes[0]).toBe('Lead from Meta form Enquiry form via ad Diwali ad');
  });

  it('a bad signature stores nothing', async () => {
    const crm = fakeCrm({ 111: 7 });
    expect(await crm.deliver(webhookBody('L1'), 'sha256=bad', {})).toBe(401);
    expect(crm.inbox.size).toBe(0);
  });

  it('an unknown page_id is marked ignored', async () => {
    const crm = fakeCrm({ 111: 7 });
    const raw = webhookBody('L9', '999');
    await crm.deliver(raw, sign(raw), { L9: metaLead('L9', { full_name: 'X' }) });
    expect(crm.inbox.get('L9')?.status).toBe('ignored');
    expect(crm.leads).toHaveLength(0);
  });

  it('dedupes by e-mail and by phone within a client, never across clients', async () => {
    const crm = fakeCrm({ 111: 7, 222: 8 });
    const run = (id: string, page: string, f: Record<string, string>) => processLeadgen({ leadgen_id: id, page_id: page, form_id: 'F1' }, crm.deps({ [id]: metaLead(id, f) }));
    await run('A', '111', { full_name: 'Ravi Kumar', phone_number: '9876543210', email: 'ravi@example.com' });
    const byPhone = await run('B', '111', { full_name: 'Ravi K', phone_number: '+919876543210', email: 'other@example.com' });
    const byEmail = await run('C', '111', { full_name: 'Ravi', phone_number: '9000000001', email: ' RAVI@example.com ' });
    const otherClient = await run('D', '222', { full_name: 'Ravi Kumar', phone_number: '9876543210', email: 'ravi@example.com' });
    expect(byPhone).toMatchObject({ status: 'synced', duplicate: true, leadId: 1 });
    expect(byEmail).toMatchObject({ status: 'synced', duplicate: true, leadId: 1 });
    expect(otherClient).toMatchObject({ status: 'synced', duplicate: false, userId: 8 });
    expect(crm.leads.map((l) => l.userId)).toEqual([7, 8]);
  });
});

// ------------------------------------------------------------------ mapping

describe('field_data mapping', () => {
  it('takes the first value, splits full_name and keeps custom questions', () => {
    const fields = flattenFieldData([
      { name: 'full_name', values: ['Asha  Rani Verma'] }, { name: 'email', values: ['  Asha@Example.COM '] },
      { name: 'phone_number', values: ['098765 43210'] }, { name: 'city', values: ['Jaipur'] },
      { name: 'which_car?', values: ['Nexon', 'Punch'] }, { name: 'budget', values: [] },
    ]);
    const m = mapLead(fields, 'IN');
    expect(m).toMatchObject({ name: 'Asha Rani Verma', firstName: 'Asha', lastName: 'Rani Verma', email: 'asha@example.com', phoneE164: '+919876543210', city: 'Jaipur' });
    expect(m.custom).toEqual({ 'which_car?': 'Nexon' });
  });

  it('copes with a missing last name and uses first_name / last_name when given', () => {
    expect(mapLead({ full_name: 'Madhuri' })).toMatchObject({ name: 'Madhuri', firstName: 'Madhuri', lastName: '' });
    expect(mapLead({ first_name: 'Neha', last_name: 'Shah' })).toMatchObject({ name: 'Neha Shah', firstName: 'Neha', lastName: 'Shah' });
    expect(mapLead({ first_name: 'Neha' })).toMatchObject({ name: 'Neha', lastName: '' });
  });

  it('normalises phone numbers to E.164 with the client’s country', () => {
    expect(toE164('9876543210', 'IN')).toBe('+919876543210');
    expect(toE164('919876543210', 'IN')).toBe('+919876543210');
    expect(toE164('9123456789', 'IN')).toBe('+919123456789');
    expect(toE164('+971 50 123 4567', 'IN')).toBe('+971501234567');
    expect(toE164('0501234567', 'AE')).toBe('+971501234567');
    expect(toE164('00447700900123', 'IN')).toBe('+447700900123');
    expect(toE164('abc', 'IN')).toBe('');
  });
});

// ------------------------------------------------------------------ settings + provisioning

const TEMPLATE: LeadTemplate = {
  mt_campaign_name: '{client} · Lead Ad · {date}', mt_form_name: '{client} form', mt_questions: [{ type: 'FULL_NAME' }, { type: 'PHONE' }],
  mt_privacy_link_text: 'Privacy', mt_thank_you_title: 'Thanks', mt_thank_you_body: 'We will call you', mt_thank_you_button: 'Visit',
  mt_locale: 'en_US', mt_countries: ['IN'], mt_age_min: 18, mt_age_max: 65, mt_daily_budget: 50000, mt_headline: '', mt_primary_text: 'Book a test drive',
  mt_cta: 'SIGN_UP', mt_special_ad_categories: [], mt_locations: [],
};
const CLIENT: ClientConfig = {
  mc_user_id: 7, mc_ad_account_id: '123456', mc_page_id: '111', mc_privacy_policy_url: 'https://c.example/privacy', mc_website_url: 'https://c.example',
  mc_image_url: 'https://c.example/a.jpg', mc_daily_budget: null, mc_countries: null, mc_age_min: 25, mc_age_max: null, mc_headline: '',
  mc_primary_text: '', mc_cta: 'APPLY_NOW', mc_special_ad_categories: null, mc_country_code: 'IN', mc_assignee: 0, mc_is_active: 1, mc_questions: null, mc_locations: null,
};

describe('settings merge', () => {
  it('uses the client value when set, else the template', () => {
    const s = mergeSettings(TEMPLATE, CLIENT, 'Tata Motors', new Date(2026, 10, 20));
    expect(s).toMatchObject({
      adAccountId: 'act_123456', dailyBudget: 50000, ageMin: 25, ageMax: 65, cta: 'APPLY_NOW', headline: 'Tata Motors',
      primaryText: 'Book a test drive', campaignName: 'Tata Motors · Lead Ad · 2026-11-20', formName: 'Tata Motors form',
    });
  });

  it('takes the target area as a whole and the client questions when set', () => {
    const tpl = { ...TEMPLATE, mt_locations: [{ type: 'city', key: '1035921', name: 'Mumbai' }] };
    expect(mergeSettings(tpl, CLIENT, 'X')).toMatchObject({ countries: ['IN'], locations: [{ type: 'city', key: '1035921' }] });
    // the client's own countries replace the template's places too
    expect(mergeSettings(tpl, { ...CLIENT, mc_countries: ['AE'] }, 'X')).toMatchObject({ countries: ['AE'], locations: [] });
    const own = mergeSettings(tpl, { ...CLIENT, mc_locations: [{ type: 'radius', name: 'Shop', lat: 19.1, lng: 72.8, km: 5 }],
      mc_questions: [{ type: 'PHONE' }, { type: 'CUSTOM', label: 'Your budget?', options: [{ value: 'Low', key: '' }, { value: 'High', key: '' }] }] }, 'X');
    expect(own.countries).toEqual([]);
    expect(own.locations).toEqual([{ type: 'radius', name: 'Shop', lat: 19.1, lng: 72.8, km: 5 }]);
    expect(own.questions).toEqual([{ type: 'PHONE' }, { type: 'CUSTOM', label: 'Your budget?', key: 'your_budget', options: [{ key: 'low', value: 'Low' }, { key: 'high', value: 'High' }] }]);
    expect(settingsProblems({ ...own, locations: [] })).toContain('Target area');
  });
});

describe('form questions and target area', () => {
  it('checks the questions', () => {
    expect(questionsProblem([{ type: 'FULL_NAME' }, { type: 'CUSTOM', label: 'Budget?' }])).toBe('');
    expect(questionsProblem([])).toMatch(/at least one/);
    expect(questionsProblem([{ type: 'CUSTOM', label: ' ' }])).toMatch(/type the question/);
    expect(questionsProblem([{ type: 'CUSTOM', label: 'A?', options: [{ value: 'only', key: '' }] }])).toMatch(/2 answers/);
    expect(questionsProblem([{ type: 'EMAIL' }, { type: 'EMAIL' }])).toMatch(/twice/);
  });

  it('makes unique keys and keeps existing ones', () => {
    expect(withKeys([{ type: 'CUSTOM', label: 'Budget?' }, { type: 'CUSTOM', label: 'Budget!' }, { type: 'CUSTOM', key: 'mine', label: 'x' }]).map((q) => q.key))
      .toEqual(['budget', 'budget_2', 'mine']);
  });

  it('reads coordinates and Google Maps links', () => {
    expect(parseLatLng('19.1197, 72.8468')).toEqual({ lat: 19.1197, lng: 72.8468 });
    expect(parseLatLng('https://www.google.com/maps/place/X/@18.5204,73.8567,15z/data=!3d18.52!4d73.85')).toEqual({ lat: 18.5204, lng: 73.8567 });
    expect(parseLatLng('https://maps.google.com/?q=12.97,77.59')).toEqual({ lat: 12.97, lng: 77.59 });
    expect(parseLatLng('Mumbai')).toBeNull();
    expect(parseLatLng('95, 10')).toBeNull();
  });

  it('cleans places and builds geo_locations', () => {
    const places = cleanLocations([
      { type: 'radius', name: 'Shop', lat: 19.1, lng: 72.8, km: 5 }, { type: 'radius', name: 'Dup', lat: 19.1, lng: 72.8, km: 5 },
      { type: 'radius', lat: 1, lng: 1, km: 500 }, { type: 'city', key: '1035921', name: 'Mumbai', km: 25 }, { type: 'city', key: '99', name: 'Tiny', km: 5 },
      { type: 'region', key: '1739', name: 'Maharashtra' }, { type: 'zip', key: 'IN:411001', name: '411001' }, { type: 'country', key: 'IN' }, 'junk',
    ]);
    expect(places.map((p) => p.type)).toEqual(['radius', 'city', 'city', 'region', 'zip']);
    expect(places[2]).toEqual({ type: 'city', key: '99', name: 'Tiny' }); // radius below Meta's 17 km dropped
    expect(geoLocations(['IN'], [])).toEqual({ countries: ['IN'] });
    expect(geoLocations(['IN'], places)).toEqual({
      custom_locations: [{ latitude: 19.1, longitude: 72.8, radius: 5, distance_unit: 'kilometer' }],
      cities: [{ key: '1035921', radius: 25, distance_unit: 'kilometer' }, { key: '99' }],
      regions: [{ key: '1739' }], zips: [{ key: 'IN:411001' }], location_types: ['home', 'recent'],
    });
  });

  it('reads Meta location search results', () => {
    expect(foundLocations([
      { key: '1035921', name: 'Mumbai', type: 'city', region: 'Maharashtra', country_name: 'India' },
      { key: 'IN', name: 'India', type: 'country' },
      { key: 'IN:411001', name: '411001', type: 'zip', region: 'Maharashtra', primary_city: 'Pune', country_code: 'IN' },
    ])).toEqual([
      { type: 'city', key: '1035921', name: 'Mumbai', detail: 'Maharashtra, India' },
      { type: 'zip', key: 'IN:411001', name: '411001', detail: 'Maharashtra, Pune, IN' },
    ]);
  });
});

/** A fake Graph API: records every call, returns ids, and can fail one path once. */
function fakeGraph(failOnce?: { path: RegExp; error: MetaError }) {
  const calls: { method: string; path: string; params: Record<string, unknown> }[] = [];
  let failed = false;
  let n = 0;
  const g: Graph = {
    get: async (path, params = {}) => {
      calls.push({ method: 'GET', path, params });
      return (path === '111' ? { access_token: 'PAGE_TOKEN' } : {}) as never;
    },
    post: async (path, params = {}) => {
      calls.push({ method: 'POST', path, params });
      if (failOnce && !failed && failOnce.path.test(path)) { failed = true; throw failOnce.error; }
      if (path.endsWith('subscribed_apps')) return { success: true } as never;
      return { id: `id${++n}` } as never;
    },
  };
  return { g, calls };
}

describe('provisioning', () => {
  const s: AdSettings = mergeSettings(TEMPLATE, CLIENT, 'Tata Motors');
  const none: AssetIds = { subscribed: false, formId: '', imageHash: '', campaignId: '', adsetId: '', creativeId: '', adId: '' };

  it('creates everything paused, in order', async () => {
    const { g, calls } = fakeGraph();
    const ids = await provision(s, none, { graph: g, loadImage: async () => ({ bytes: new Uint8Array([1]), name: 'a.jpg' }), uploadImage: async () => 'HASH', save: async () => {} });
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual([
      '111/subscribed_apps', '111/leadgen_forms', 'act_123456/campaigns', 'act_123456/adsets', 'act_123456/adcreatives', 'act_123456/ads',
    ]);
    const posts = Object.fromEntries(calls.filter((c) => c.method === 'POST').map((c) => [c.path.split('/')[1], c.params]));
    expect(posts.campaigns).toMatchObject({ objective: 'OUTCOME_LEADS', status: 'PAUSED', special_ad_categories: [], is_adset_budget_sharing_enabled: false });
    expect(posts.adsets).toMatchObject({ status: 'PAUSED', destination_type: 'ON_AD', optimization_goal: 'LEAD_GENERATION', promoted_object: { page_id: '111' } });
    expect(posts.ads).toMatchObject({ status: 'PAUSED', creative: { creative_id: ids.creativeId } });
    expect((posts.adcreatives as any).object_story_spec.link_data.call_to_action).toEqual({ type: 'APPLY_NOW', value: { lead_gen_form_id: ids.formId } });
    expect(ids.adId).toBeTruthy();
  });

  it('resumes from the last saved step after a failure mid-way', async () => {
    const saved: AssetIds = { ...none };
    const save = async (p: Partial<AssetIds>) => { Object.assign(saved, p); };
    const deps = (g: Graph) => ({ graph: g, loadImage: async () => ({ bytes: new Uint8Array([1]), name: 'a.jpg' }), uploadImage: async () => 'HASH', save });

    const first = fakeGraph({ path: /adsets$/, error: new MetaError('Invalid budget', 100) });
    await expect(provision(s, saved, deps(first.g))).rejects.toThrow('Invalid budget');
    expect(saved).toMatchObject({ subscribed: true, imageHash: 'HASH', adsetId: '', adId: '' });
    expect(saved.formId).not.toBe('');
    expect(saved.campaignId).not.toBe('');

    const second = fakeGraph();
    const ids = await provision(s, { ...saved }, deps(second.g));
    expect(second.calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['act_123456/adsets', 'act_123456/adcreatives', 'act_123456/ads']);
    expect(ids.campaignId).toBe(saved.campaignId);
    expect(ids.adId).toBeTruthy();
  });

  it('retries the ad set without Advantage+ audience when Meta refuses the age range', async () => {
    const { g, calls } = fakeGraph({ path: /adsets$/, error: new MetaError('Advantage audience: age_max must be 65', 100) });
    const notes: string[] = [];
    await provision(s, none, { graph: g, loadImage: async () => ({ bytes: new Uint8Array([1]), name: 'a.jpg' }), uploadImage: async () => 'HASH', save: async (p) => { if (p.note) notes.push(p.note); } });
    const adsets = calls.filter((c) => c.path.endsWith('adsets'));
    expect(adsets.map((c) => (c.params.targeting as any).targeting_automation.advantage_audience)).toEqual([1, 0]);
    expect(notes[0]).toMatch(/Advantage\+ audience was refused/);
  });
});

// ------------------------------------------------------------------ Graph client

describe('Graph client', () => {
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('retries rate limits with backoff and sends the token only in the header', async () => {
    const seen: { url: string; auth: string; body: string }[] = [];
    const replies = [reply(400, { error: { message: 'Too many calls', code: 17 } }), reply(500, { error: { message: 'Unknown', code: 2 } }), reply(200, { id: 'X1' })];
    const sleeps: number[] = [];
    const g = createGraph({
      baseUrl: 'https://graph.test/v25.0/', token: 'SECRET_TOKEN', sleep: async (ms) => { sleeps.push(ms); },
      fetch: (async (url: string, init: RequestInit) => { seen.push({ url, auth: String((init.headers as Record<string, string>).Authorization), body: String(init.body ?? '') }); return replies.shift()!; }) as never,
    });
    expect(await g.post('act_1/campaigns', { name: 'x', special_ad_categories: [] })).toEqual({ id: 'X1' });
    expect(seen).toHaveLength(3);
    expect(sleeps[1]).toBeGreaterThan(sleeps[0]);
    expect(seen.every((s) => !s.url.includes('SECRET_TOKEN') && !s.body.includes('SECRET_TOKEN') && s.auth === 'Bearer SECRET_TOKEN')).toBe(true);
    expect(seen[0].body).toContain('special_ad_categories=%5B%5D');
  });

  it('throws a typed error with code and subcode, without retrying a permanent error', async () => {
    let calls = 0;
    const g = createGraph({
      baseUrl: 'https://graph.test/v25.0/', token: 'T', sleep: async () => {},
      fetch: (async () => { calls++; return reply(400, { error: { message: 'Invalid parameter', code: 100, error_subcode: 1487390 } }); }) as never,
    });
    const err = await g.get('x').catch((e) => e);
    expect(err).toBeInstanceOf(MetaError);
    expect(err).toMatchObject({ code: 100, subcode: 1487390, message: 'Invalid parameter' });
    expect(calls).toBe(1);
  });
});
