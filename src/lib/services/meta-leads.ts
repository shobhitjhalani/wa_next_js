import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config';
import { exec, one, query, value } from '../db';
import { createGraph, fetchLead as graphFetchLead, getPageToken, graphList, LEAD_FIELDS, MetaError, uploadImage, type Graph, type MetaLead } from '../meta-graph';
import {
  activate, leadgenChanges, mergeSettings, processLeadgen, provision, retryDelay, settingsProblems,
  type AdSettings, type AssetIds, type ClientConfig, type LeadgenChange, type LeadTemplate, type SaveInput,
} from '../meta-leads';
import { foundLocations, type FoundLocation } from '../meta-ad-form';
import { now } from '../time';
import { saveLead } from './crm';
import { refreshMetaSettings } from './meta-settings';

/**
 * Meta Lead Ads (agency): provisioning the common lead ad per client (worker job "meta-provision"), the leadgen inbox
 * (webhook → js_meta_lead_events → job "meta-leads"), the backfill (job "meta-leads-backfill") and admin helpers.
 * Tokens are never logged or stored in error texts.
 */

const log = (m: string) => console.log(`[meta-leads] ${m}`);

// ------------------------------------------------------------------ token + graph

/** META_SYSTEM_USER_TOKEN, else the newest working User / System User token saved on /wamaster/fb_posts/pages. */
export async function systemToken(): Promise<string> {
  await refreshMetaSettings();
  if (config.metaAds.systemUserToken) return config.metaAds.systemUserToken;
  return (await value<string>("SELECT ft_token FROM js_fb_token WHERE ft_kind = 'user' AND ft_status <> 2 ORDER BY ft_checked_on DESC LIMIT 1")) ?? '';
}

export async function tokenSource(): Promise<'env' | 'saved' | 'none'> {
  await refreshMetaSettings();
  if (config.metaAds.systemUserToken) return 'env';
  return (await value("SELECT 1 FROM js_fb_token WHERE ft_kind = 'user' AND ft_status <> 2 LIMIT 1")) ? 'saved' : 'none';
}

async function graph(): Promise<Graph> {
  return createGraph({ baseUrl: config.metaAds.graphUrl, token: await systemToken() });
}

// ------------------------------------------------------------------ settings

export async function template(): Promise<LeadTemplate & { mt_updated_on: number }> {
  return (await one<LeadTemplate & { mt_updated_on: number }>('SELECT * FROM js_meta_lead_template WHERE mt_id = 1'))!;
}

export async function clientSettings(userId: number, date = new Date()): Promise<{ settings: AdSettings; config: ClientConfig } | null> {
  const c = await one<ClientConfig & { client: string }>(
    `SELECT c.*, COALESCE(NULLIF(u.u_company_name, ''), NULLIF(u.u_name, ''), u.u_username::text) AS client
       FROM js_meta_client_config c JOIN js_user u ON u.u_id = c.mc_user_id WHERE c.mc_user_id = $1`, [userId]);
  if (!c) return null;
  return { settings: mergeSettings(await template(), c, c.client, date), config: c };
}

/** Meta's location search for the target area (cities, states / regions, PIN codes), optionally within one country. */
export async function searchLocations(q: string, countryCode = ''): Promise<FoundLocation[]> {
  const res = await (await graph()).get<{ data?: unknown[] }>('search', {
    type: 'adgeolocation', q, location_types: ['city', 'region', 'zip'], limit: 25,
    ...(/^[A-Z]{2}$/.test(countryCode) ? { country_code: countryCode } : {}),
  });
  return foundLocations(res.data);
}

// ------------------------------------------------------------------ provisioning

interface AssetRow {
  ma_id: number; ma_user_id: number; ma_ad_account_id: string; ma_page_id: string; ma_subscribed: number; ma_form_id: string;
  ma_campaign_id: string; ma_image_hash: string; ma_adset_id: string; ma_creative_id: string; ma_ad_id: string; ma_status: string;
  ma_campaign_name: string; ma_form_name: string;
}

const COLUMN: Record<keyof AssetIds, string> = {
  subscribed: 'ma_subscribed', formId: 'ma_form_id', imageHash: 'ma_image_hash', campaignId: 'ma_campaign_id',
  adsetId: 'ma_adset_id', creativeId: 'ma_creative_id', adId: 'ma_ad_id',
};

/**
 * Queue "Create Lead Ad" for these clients: a failed (or interrupted) one resumes, a queued / running one is left
 * alone, otherwise a new set is started. Returns [queued, skipped with reason].
 */
export async function requestProvision(userIds: number[], empId: number): Promise<{ queued: number; skipped: string[] }> {
  let queued = 0;
  const skipped: string[] = [];
  for (const userId of userIds) {
    const cs = await clientSettings(userId);
    if (!cs) { skipped.push(`#${userId}: no Meta Lead Ads settings`); continue; }
    const name = cs.settings.clientName;
    if (!cs.config.mc_is_active) { skipped.push(`${name}: switched off`); continue; }
    if (Number(await value('SELECT u_ads FROM js_user WHERE u_id = $1', [userId])) !== 1) { skipped.push(`${name}: Ads Management is off for this account`); continue; }
    const missing = settingsProblems(cs.settings);
    if (missing.length) { skipped.push(`${name}: missing ${missing.join(', ')}`); continue; }
    const last = await one<{ ma_id: number; ma_status: string }>('SELECT ma_id, ma_status FROM js_meta_campaign_assets WHERE ma_user_id = $1 ORDER BY ma_id DESC LIMIT 1', [userId]);
    if (last && ['queued', 'running', 'activating'].includes(last.ma_status)) { skipped.push(`${name}: already being created`); continue; }
    if (last?.ma_status === 'failed') {
      await exec("UPDATE js_meta_campaign_assets SET ma_status = 'queued', ma_last_error = '', ma_updated_at = $2 WHERE ma_id = $1", [last.ma_id, now()]);
    } else {
      await exec(
        `INSERT INTO js_meta_campaign_assets (ma_user_id, ma_ad_account_id, ma_page_id, ma_campaign_name, ma_form_name, ma_emp_id, ma_created_at, ma_updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
        [userId, cs.settings.adAccountId, cs.settings.pageId, cs.settings.campaignName, cs.settings.formName, empId, now()]);
    }
    queued++;
  }
  return { queued, skipped };
}

/** Load the creative image: a file of this app's /media (read from disk) or any public URL. */
async function loadImage(url: string): Promise<{ bytes: Uint8Array; name: string }> {
  const name = decodeURIComponent(url.split('?')[0].split('/').pop() || 'image.jpg');
  const local = /\/media\/(.+)$/.exec(url.split('?')[0]);
  if (local && url.startsWith(config.appUrl)) {
    const file = path.resolve(config.mediaPath, decodeURIComponent(local[1]));
    if (file.startsWith(path.resolve(config.mediaPath))) return { bytes: await readFile(file), name };
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new MetaError(`The creative image could not be downloaded (HTTP ${res.status}).`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), name };
}

/** Worker job "meta-provision": run queued provisionings (resuming from the saved ids) and confirmed activations. */
export async function runProvisioning(jobLog: (m: string) => void = () => {}): Promise<number> {
  const t = now();
  // A run interrupted mid-way (worker restarted) is retried from where it stopped
  await exec("UPDATE js_meta_campaign_assets SET ma_status = 'queued' WHERE ma_status = 'running' AND ma_updated_at < $1", [t - 900]);
  const rows = await query<AssetRow>(
    `UPDATE js_meta_campaign_assets SET ma_status = CASE ma_status WHEN 'queued' THEN 'running' ELSE ma_status END, ma_updated_at = $1
      WHERE ma_id IN (SELECT ma_id FROM js_meta_campaign_assets WHERE ma_status IN ('queued', 'activating') ORDER BY ma_id LIMIT 5 FOR UPDATE SKIP LOCKED)
      RETURNING *`, [t]);
  if (!rows.length) return 0;
  const g = await graph();
  for (const r of rows) {
    if (r.ma_status === 'activating') {
      try {
        await activate(g, { campaignId: r.ma_campaign_id, adsetId: r.ma_adset_id, adId: r.ma_ad_id });
        await exec("UPDATE js_meta_campaign_assets SET ma_status = 'active', ma_last_error = '', ma_updated_at = $2 WHERE ma_id = $1", [r.ma_id, now()]);
        jobLog(`meta-provision: #${r.ma_id} activated`);
      } catch (e) {
        const msg = e instanceof MetaError ? e.describe() : (e as Error).message;
        await exec("UPDATE js_meta_campaign_assets SET ma_status = 'paused', ma_last_error = $2, ma_updated_at = $3 WHERE ma_id = $1", [r.ma_id, `Activating failed: ${msg}`.slice(0, 1000), now()]);
      }
      continue;
    }
    const cs = await clientSettings(r.ma_user_id);
    if (!cs) {
      await exec("UPDATE js_meta_campaign_assets SET ma_status = 'failed', ma_last_error = 'The client’s Meta settings were removed.' WHERE ma_id = $1", [r.ma_id]);
      continue;
    }
    // The names chosen when it was queued, and the ad account / Page the first objects were created in
    const s: AdSettings = {
      ...cs.settings,
      campaignName: r.ma_campaign_name || cs.settings.campaignName, formName: r.ma_form_name || cs.settings.formName,
      adAccountId: r.ma_campaign_id ? r.ma_ad_account_id : cs.settings.adAccountId,
      pageId: r.ma_subscribed || r.ma_form_id ? r.ma_page_id : cs.settings.pageId,
    };
    await exec('UPDATE js_meta_campaign_assets SET ma_ad_account_id = $2, ma_page_id = $3 WHERE ma_id = $1', [r.ma_id, s.adAccountId, s.pageId]);
    const done: AssetIds = {
      subscribed: !!r.ma_subscribed, formId: r.ma_form_id, imageHash: r.ma_image_hash, campaignId: r.ma_campaign_id,
      adsetId: r.ma_adset_id, creativeId: r.ma_creative_id, adId: r.ma_ad_id,
    };
    try {
      await provision(s, done, {
        graph: g, loadImage, uploadImage: (act, file) => uploadImage(g, act, file),
        save: async (patch) => {
          const sets: string[] = [];
          const args: unknown[] = [r.ma_id, now()];
          for (const [k, v] of Object.entries(patch)) {
            const col = k === 'note' ? 'ma_note' : COLUMN[k as keyof AssetIds];
            if (!col) continue;
            args.push(typeof v === 'boolean' ? (v ? 1 : 0) : v);
            sets.push(`${col} = $${args.length}`);
          }
          if (sets.length) await exec(`UPDATE js_meta_campaign_assets SET ${sets.join(', ')}, ma_updated_at = $2 WHERE ma_id = $1`, args);
        },
      });
      await exec("UPDATE js_meta_campaign_assets SET ma_status = 'paused', ma_last_error = '', ma_updated_at = $2 WHERE ma_id = $1", [r.ma_id, now()]);
      jobLog(`meta-provision: #${r.ma_id} (${s.clientName}) created, paused`);
    } catch (e) {
      const msg = e instanceof MetaError ? e.describe() : (e as Error).message;
      await exec("UPDATE js_meta_campaign_assets SET ma_status = 'failed', ma_last_error = $2, ma_updated_at = $3 WHERE ma_id = $1", [r.ma_id, msg.slice(0, 1000), now()]);
      jobLog(`meta-provision: #${r.ma_id} (${s.clientName}) failed: ${msg.slice(0, 200)}`);
    }
  }
  return rows.length;
}

/** "Activate" (after the admin confirmed): only a complete, paused ad. */
export async function requestActivate(assetId: number): Promise<boolean> {
  return (await exec(
    `UPDATE js_meta_campaign_assets SET ma_status = 'activating', ma_last_error = '', ma_updated_at = $2
      WHERE ma_id = $1 AND ma_status = 'paused' AND ma_ad_id <> ''`, [assetId, now()])) > 0;
}

// ------------------------------------------------------------------ inbox

/** Store leadgen notifications (a leadgen_id already in the inbox is ignored); returns the new event ids. */
export async function recordLeadgen(changes: LeadgenChange[], via: 'webhook' | 'backfill' = 'webhook'): Promise<number[]> {
  const ids: number[] = [];
  const t = now();
  for (const c of changes) {
    const id = await value<number>(
      `INSERT INTO js_meta_lead_events (me_leadgen_id, me_page_id, me_form_id, me_ad_id, me_raw_payload, me_via, me_created_at, me_updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7) ON CONFLICT (me_leadgen_id) DO NOTHING RETURNING me_id`,
      [c.leadgen_id, c.page_id, c.form_id, c.ad_id, JSON.stringify(c.raw), via, t]);
    if (id) ids.push(Number(id));
  }
  return ids;
}

export { leadgenChanges };

const pageTokens = new Map<string, { token: string; at: number }>();
async function pageToken(g: Graph, pageId: string): Promise<string> {
  const hit = pageTokens.get(pageId);
  if (hit && hit.at > Date.now() - 30 * 60_000) return hit.token;
  const token = await getPageToken(g, pageId);
  pageTokens.set(pageId, { token, at: Date.now() });
  return token;
}

/** The lead with the System User token; if Meta refuses that, with the Page token. */
async function readLead(g: Graph, leadgenId: string, pageId: string): Promise<MetaLead> {
  try {
    return await graphFetchLead(g, leadgenId);
  } catch (e) {
    if (!(e instanceof MetaError) || e.retryable || !pageId) throw e;
    return graphFetchLead(g, leadgenId, await pageToken(g, pageId));
  }
}

function deps(g: Graph) {
  return {
    clientForPage: async (pageId: string) => {
      const c = await one<{ mc_user_id: number; mc_country_code: string; mc_assignee: number }>(
        `SELECT c.mc_user_id, c.mc_country_code, c.mc_assignee FROM js_meta_client_config c JOIN js_user u ON u.u_id = c.mc_user_id AND u.u_dstatus = 0
          WHERE c.mc_page_id = $1 AND c.mc_is_active = 1 ORDER BY c.mc_user_id LIMIT 1`, [pageId]);
      return c ? { userId: c.mc_user_id, country: c.mc_country_code || 'IN', assignee: c.mc_assignee } : null;
    },
    fetchLead: (id: string, pageId: string) => readLead(g, id, pageId),
    formName: async (formId: string, pageId: string) => {
      const known = await value<string>("SELECT ma_form_name FROM js_meta_campaign_assets WHERE ma_form_id = $1 AND ma_form_name <> '' LIMIT 1", [formId]);
      if (known) return known;
      const f = await g.get<{ name?: string }>(formId, { fields: 'name' }).catch(async () => g.get<{ name?: string }>(formId, { fields: 'name' }, await pageToken(g, pageId)));
      return String(f.name ?? '');
    },
    saveLead: (i: SaveInput) => saveLead(i.userId, {
      name: i.lead.name, mobile: i.lead.phoneE164.replace(/^\+/, '') || i.lead.phone, email: i.lead.email, source: 'meta_lead_ad',
      campaign: i.meta.campaignName || i.meta.adName || (i.meta.formName ? `Form: ${i.meta.formName}` : ''),
      fields: {
        ...i.lead.custom,
        ...(i.lead.firstName ? { first_name: i.lead.firstName } : {}), ...(i.lead.lastName ? { last_name: i.lead.lastName } : {}),
        ...(i.lead.city ? { city: i.lead.city } : {}),
      },
      externalId: i.meta.leadgenId, matchEmail: true, assignedMember: i.assignee, activity: i.activity,
      meta: { ...i.meta, phoneE164: i.lead.phoneE164 },
    }, ''),
  };
}

/**
 * Process one inbox event: claim it (so the webhook's after() and the job never both run it), skip it when already
 * synced, then save the lead; on an error retry later (1, 5, 15, 60 min), 5 tries in total.
 */
export async function processEvent(id: number, g?: Graph): Promise<string> {
  const t = now();
  const ev = await one<{ me_id: number; me_leadgen_id: string; me_page_id: string; me_form_id: string; me_attempts: number }>(
    `UPDATE js_meta_lead_events SET me_next_attempt_at = $2 + 600, me_updated_at = $2
      WHERE me_id = $1 AND me_status IN ('received', 'failed') AND me_next_attempt_at <= $2
      RETURNING me_id, me_leadgen_id, me_page_id, me_form_id, me_attempts`, [id, t]);
  if (!ev) return 'skipped';
  // A lead already saved (e.g. by the client's own /api/crm webhook) is found by its leadgen id and only linked
  try {
    const res = await processLeadgen({ leadgen_id: ev.me_leadgen_id, page_id: ev.me_page_id, form_id: ev.me_form_id }, deps(g ?? await graph()));
    if (res.status === 'ignored') {
      console.warn(`[meta-leads] event ${ev.me_id} ignored: ${res.reason}`);
      await exec("UPDATE js_meta_lead_events SET me_status = 'ignored', me_error = $2, me_updated_at = $3 WHERE me_id = $1", [ev.me_id, res.reason, now()]);
      return 'ignored';
    }
    await exec(
      "UPDATE js_meta_lead_events SET me_status = 'synced', me_user_id = $2, me_crm_lead_id = $3, me_error = '', me_attempts = me_attempts + 1, me_updated_at = $4 WHERE me_id = $1",
      [ev.me_id, res.userId, res.leadId, now()]);
    return 'synced';
  } catch (e) {
    const attempts = ev.me_attempts + 1;
    const wait = retryDelay(attempts);
    const msg = (e instanceof MetaError ? e.describe() : (e as Error).message).slice(0, 1000);
    await exec(
      `UPDATE js_meta_lead_events SET me_status = 'failed', me_attempts = $2, me_error = $3, me_next_attempt_at = $4, me_updated_at = $5 WHERE me_id = $1`,
      [ev.me_id, attempts, msg, wait === null ? 2147483647 : now() + wait, now()]);
    log(`event ${ev.me_id} failed (try ${attempts}${wait === null ? ', giving up' : ''}): ${msg.slice(0, 200)}`);
    return 'failed';
  }
}

/** Worker job "meta-leads": new events and failed ones whose retry time has come. */
export async function processPendingEvents(jobLog: (m: string) => void = () => {}): Promise<number> {
  const ids = await query<{ me_id: number }>(
    "SELECT me_id FROM js_meta_lead_events WHERE me_status IN ('received', 'failed') AND me_next_attempt_at <= $1 ORDER BY me_id LIMIT 100", [now()]);
  if (!ids.length) return 0;
  const g = await graph();
  const counts: Record<string, number> = {};
  for (const { me_id } of ids) {
    const r = await processEvent(Number(me_id), g);
    counts[r] = (counts[r] ?? 0) + 1;
  }
  jobLog(`meta-leads: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}`);
  return ids.length;
}

/** Admin "Retry": failed events (one or all) are tried again now, with a fresh try count. */
export async function retryEvents(id?: number): Promise<number> {
  return exec(
    `UPDATE js_meta_lead_events SET me_status = 'received', me_attempts = 0, me_next_attempt_at = 0, me_error = '', me_updated_at = $2
      WHERE me_status = 'failed' AND ($1::bigint IS NULL OR me_id = $1)`, [id ?? null, now()]);
}

// ------------------------------------------------------------------ backfill

/**
 * Worker job "meta-leads-backfill" (every 30 min): for each form of an active client, read the leads created since the
 * last sync (time_created > last_sync, following paging.cursors.after). They go through the same inbox, where the
 * unique leadgen_id drops the ones the webhook already delivered.
 */
export async function backfillLeads(jobLog: (m: string) => void = () => {}): Promise<number> {
  const forms = await query<{ form_id: string; page_id: string; created: number; last_sync: number | null }>(
    `SELECT DISTINCT ON (a.ma_form_id) a.ma_form_id AS form_id, a.ma_page_id AS page_id, a.ma_created_at AS created, s.fs_last_sync AS last_sync
       FROM js_meta_campaign_assets a
       JOIN js_meta_client_config c ON c.mc_user_id = a.ma_user_id AND c.mc_is_active = 1
       LEFT JOIN js_meta_form_sync s ON s.fs_form_id = a.ma_form_id
      WHERE a.ma_form_id <> '' ORDER BY a.ma_form_id, a.ma_id DESC`);
  if (!forms.length) return 0;
  const g = await graph();
  let found = 0;
  for (const f of forms) {
    const since = f.last_sync ?? Math.max(0, f.created - 3600);
    try {
      const leads = await graphList<MetaLead & { created_time?: string }>(g, `${f.form_id}/leads`, {
        fields: LEAD_FIELDS, limit: 100, filtering: [{ field: 'time_created', operator: 'GREATER_THAN', value: since }],
      }, 5000, await pageToken(g, f.page_id));
      const ids = await recordLeadgen(leads.map((l) => ({
        leadgen_id: String(l.id), page_id: f.page_id, form_id: f.form_id, ad_id: String(l.ad_id ?? ''),
        created_time: Math.floor(Date.parse(l.created_time ?? '') / 1000) || 0, raw: { leadgen_id: l.id, form_id: f.form_id, page_id: f.page_id, backfill: true },
      })), 'backfill');
      found += ids.length;
      const newest = Math.max(since, ...leads.map((l) => Math.floor(Date.parse(l.created_time ?? '') / 1000) || 0));
      await exec(
        `INSERT INTO js_meta_form_sync (fs_form_id, fs_last_sync, fs_checked_on, fs_error) VALUES ($1, $2, $3, '')
         ON CONFLICT (fs_form_id) DO UPDATE SET fs_last_sync = GREATEST(js_meta_form_sync.fs_last_sync, $2), fs_checked_on = $3, fs_error = ''`,
        [f.form_id, newest, now()]);
    } catch (e) {
      const msg = (e instanceof MetaError ? e.describe() : (e as Error).message).slice(0, 500);
      await exec(
        `INSERT INTO js_meta_form_sync (fs_form_id, fs_last_sync, fs_checked_on, fs_error) VALUES ($1, $2, $3, $4)
         ON CONFLICT (fs_form_id) DO UPDATE SET fs_checked_on = $3, fs_error = $4`, [f.form_id, since, now(), msg]);
      jobLog(`meta-leads-backfill: form ${f.form_id} failed: ${msg.slice(0, 200)}`);
    }
  }
  if (found) {
    jobLog(`meta-leads-backfill: ${found} lead(s) the webhook had missed`);
    await processPendingEvents(jobLog);
  }
  return found;
}

// ------------------------------------------------------------------ health

export async function webhookHealth() {
  const [counts, last] = await Promise.all([
    query<{ me_status: string; n: number; day: number }>(
      `SELECT me_status, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE me_created_at > $1)::int AS day FROM js_meta_lead_events GROUP BY me_status`, [now() - 86400]),
    one<{ me_created_at: number; me_via: string; me_status: string }>(
      "SELECT me_created_at, me_via, me_status FROM js_meta_lead_events WHERE me_via = 'webhook' ORDER BY me_id DESC LIMIT 1"),
  ]);
  const by = Object.fromEntries(counts.map((c) => [c.me_status, c]));
  const total = counts.reduce((a, c) => a + c.n, 0);
  return {
    total, received: by.received?.n ?? 0, synced: by.synced?.n ?? 0, failed: by.failed?.n ?? 0, ignored: by.ignored?.n ?? 0,
    day: counts.reduce((a, c) => a + c.day, 0), lastWebhookAt: last?.me_created_at ?? 0,
  };
}
