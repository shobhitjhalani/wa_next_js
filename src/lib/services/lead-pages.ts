import 'server-only';
import { config } from '../config';
import { exec, query } from '../db';
import { createGraph, getPageToken, graphList, MetaError, type Graph } from '../meta-graph';
import { now } from '../time';
import { systemToken } from './meta-leads';
import { refreshGraphVersions } from './graph-version';

/**
 * Admin → Meta Lead Ads → Lead Pages: Facebook Pages whose leads go to a client's Leads CRM (several per client).
 * Pages come from the Meta token (Settings → Meta Lead Ads Keys); connecting one subscribes our app to its
 * "leadgen" webhook. Tokens never leave the server.
 */

export interface TokenPage { id: string; name: string; category: string; token: string }

async function graph(): Promise<Graph> {
  await refreshGraphVersions();
  return createGraph({ baseUrl: config.metaAds.graphUrl, token: await systemToken() });
}

const describe = (e: unknown) => (e instanceof MetaError ? e.describe() : (e as Error).message).slice(0, 500);

/** Every Page the token can reach (me/accounts), or the error Meta gave. */
export async function tokenPages(): Promise<{ pages: TokenPage[]; error: string }> {
  try {
    const g = await graph();
    const list = await graphList<{ id: string; name?: string; category?: string; access_token?: string }>(
      g, 'me/accounts', { fields: 'id,name,category,access_token', limit: 100 }, 2000);
    return {
      pages: list.map((p) => ({ id: String(p.id), name: String(p.name ?? ''), category: String(p.category ?? ''), token: String(p.access_token ?? '') }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      error: '',
    };
  } catch (e) {
    return { pages: [], error: describe(e) };
  }
}

export interface AdAccount { id: string; name: string; active: boolean }

/** Ad accounts the token can reach (me/adaccounts), ids without "act_". */
export async function tokenAdAccounts(): Promise<{ accounts: AdAccount[]; error: string }> {
  try {
    const list = await graphList<{ account_id?: string; id?: string; name?: string; account_status?: number }>(
      await graph(), 'me/adaccounts', { fields: 'account_id,name,account_status', limit: 100 }, 1000);
    return {
      accounts: list.map((a) => ({ id: String(a.account_id ?? String(a.id ?? '').replace(/^act_/, '')), name: String(a.name ?? ''), active: Number(a.account_status) === 1 }))
        .filter((a) => a.id).sort((a, b) => a.name.localeCompare(b.name)),
      error: '',
    };
  } catch (e) {
    return { accounts: [], error: describe(e) };
  }
}

async function pageTokenOf(g: Graph, pageId: string): Promise<string> {
  const hit = (await tokenPages()).pages.find((p) => p.id === pageId)?.token;
  return hit || getPageToken(g, pageId);
}

/** Subscribe our app to the Page's leadgen webhook and confirm it; returns '' or the error. */
export async function subscribePage(pageId: string): Promise<string> {
  try {
    const g = await graph();
    const token = await pageTokenOf(g, pageId);
    await g.post(`${pageId}/subscribed_apps`, { subscribed_fields: 'leadgen' }, token);
    const subs = await g.get<{ data?: { id?: string; subscribed_fields?: string[] }[] }>(`${pageId}/subscribed_apps`, {}, token);
    const ok = (subs.data ?? []).some((a) => (!config.metaAds.appId || String(a.id) === String(config.metaAds.appId)) && (a.subscribed_fields ?? []).includes('leadgen'));
    return ok ? '' : 'Meta did not confirm the leadgen subscription for our app.';
  } catch (e) {
    return describe(e);
  }
}

/**
 * Save the Page for a client (0 = not assigned) and subscribe it. Leads that arrived while no client was assigned
 * ('ignored' events of this Page) are filed now; 'filtered' ones are checked again against the new ad accounts. Returns the subscription error ('' = fine) and how many waiting
 * leads were queued.
 */
export async function connectPage(pageId: string, name: string, userId: number, empId: number, adAccounts: string[] = []): Promise<{ error: string; requeued: number }> {
  const t = now();
  await exec(
    `INSERT INTO js_meta_lead_page (lp_page_id, lp_name, lp_user_id, lp_is_active, lp_emp_id, lp_created_on, lp_updated_on, lp_ad_accounts)
     VALUES ($1, $2, $3, 1, $4, $5, $5, $6::text[])
     ON CONFLICT (lp_page_id) DO UPDATE SET lp_name = CASE WHEN EXCLUDED.lp_name <> '' THEN EXCLUDED.lp_name ELSE js_meta_lead_page.lp_name END,
       lp_user_id = EXCLUDED.lp_user_id, lp_is_active = 1, lp_emp_id = EXCLUDED.lp_emp_id, lp_updated_on = EXCLUDED.lp_updated_on,
       lp_ad_accounts = EXCLUDED.lp_ad_accounts`,
    [pageId, name.slice(0, 200), userId, empId, t, adAccounts]);
  const error = await subscribePage(pageId);
  await exec('UPDATE js_meta_lead_page SET lp_subscribed = $2, lp_error = $3 WHERE lp_page_id = $1', [pageId, error ? 0 : 1, error]);
  const requeued = userId > 0
    ? await exec(
      `UPDATE js_meta_lead_events SET me_status = 'received', me_attempts = 0, me_next_attempt_at = 0, me_error = '', me_updated_at = $2
        WHERE me_page_id = $1 AND me_status IN ('ignored', 'filtered')`, [pageId, t])
    : 0;
  return { error, requeued };
}

/** Stop filing this Page's leads (the Page stays subscribed: a client's lead ad may still use it). */
export async function disconnectPage(pageId: string): Promise<boolean> {
  return (await exec('DELETE FROM js_meta_lead_page WHERE lp_page_id = $1', [pageId])) > 0;
}

export interface SavedPage {
  lp_page_id: string; lp_name: string; lp_user_id: number; lp_ad_accounts: string[]; lp_subscribed: number; lp_error: string; lp_updated_on: number; client: string | null;
}

export async function savedPages(): Promise<SavedPage[]> {
  return query<SavedPage>(
    `SELECT p.lp_page_id, p.lp_name, p.lp_user_id, p.lp_ad_accounts, p.lp_subscribed, p.lp_error, p.lp_updated_on,
            COALESCE(NULLIF(u.u_company_name, ''), NULLIF(u.u_name, ''), u.u_username::text) AS client
       FROM js_meta_lead_page p LEFT JOIN js_user u ON u.u_id = p.lp_user_id AND u.u_dstatus = 0
      WHERE p.lp_is_active = 1 ORDER BY lower(p.lp_name)`);
}

/** Per Page: leads filed in the last 30 days, leads waiting for a client, leads skipped (other ad accounts) in 30 days. */
export async function pageLeadCounts(): Promise<Map<string, { recent: number; waiting: number; filtered: number }>> {
  const rows = await query<{ page: string; recent: number; waiting: number; filtered: number }>(
    `SELECT me_page_id AS page,
            COUNT(*) FILTER (WHERE me_status = 'synced' AND me_created_at > $1)::int AS recent,
            COUNT(*) FILTER (WHERE me_status = 'ignored')::int AS waiting,
            COUNT(*) FILTER (WHERE me_status = 'filtered' AND me_created_at > $1)::int AS filtered
       FROM js_meta_lead_events WHERE me_page_id <> '' GROUP BY me_page_id`, [now() - 30 * 86400]);
  return new Map(rows.map((r) => [r.page, { recent: r.recent, waiting: r.waiting, filtered: r.filtered }]));
}

/** Name of a Page for lists: Lead Pages, then Bulk Posting pages. */
export async function pageNames(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await query<{ id: string; name: string }>(
    `SELECT lp_page_id AS id, lp_name AS name FROM js_meta_lead_page WHERE lp_page_id = ANY($1::text[]) AND lp_name <> ''
     UNION ALL SELECT fp_page_id, fp_name FROM js_fb_page WHERE fp_page_id = ANY($1::text[]) AND fp_name <> ''`, [ids]);
  const out = new Map<string, string>();
  for (const r of rows) if (!out.has(r.id)) out.set(r.id, r.name);
  return out;
}
