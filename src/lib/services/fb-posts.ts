import 'server-only';
import { config } from '../config';
import { exec, query } from '../db';
import { now, parseDate } from '../time';

/**
 * Bulk Facebook Page posts (/wamaster/fb_posts): a CSV becomes queued posts; the worker job
 * "fb-posts" publishes the due ones with the Page's access token and records the result.
 */

export const POST_STATUS: Record<number, { label: string; badge: string }> = {
  1: { label: 'Queued', badge: 'bg-info-subtle text-info' },
  2: { label: 'Posting', badge: 'bg-warning-subtle text-warning' },
  3: { label: 'Posted', badge: 'bg-success-subtle text-success' },
  4: { label: 'Failed', badge: 'bg-danger-subtle text-danger' },
  5: { label: 'Cancelled', badge: 'bg-secondary-subtle text-secondary' },
};

export const MAX_CSV_ROWS = 500;
/** Rows × Pages of one upload. */
export const MAX_UPLOAD_POSTS = 5000;
const PER_RUN = 20;

type Graph = Record<string, any> & { error?: { message?: string; code?: number } };

async function graph(method: 'GET' | 'POST', path: string, token: string, params: Record<string, string> = {}): Promise<Graph> {
  const body = new URLSearchParams({ ...params, access_token: token });
  try {
    const res = method === 'GET'
      ? await fetch(`${config.meta.apiUrl}${path}?${body}`, { signal: AbortSignal.timeout(30_000) })
      : await fetch(`${config.meta.apiUrl}${path}`, { method: 'POST', body, signal: AbortSignal.timeout(60_000) });
    return await res.json();
  } catch (e) {
    return { error: { message: e instanceof Error ? e.message : String(e) } };
  }
}

export interface FbPageToken { id: string; name: string; token: string }

/** A short-lived user token (Graph API Explorer, ~1 hour) → a long-lived one, so the Page tokens taken from it don't expire. */
async function longLived(token: string): Promise<string> {
  const { fbAppId, appSecret } = config.meta;
  if (!fbAppId || !appSecret) return token;
  const res = await graph('GET', 'oauth/access_token', token, { grant_type: 'fb_exchange_token', client_id: fbAppId, client_secret: appSecret, fb_exchange_token: token });
  return typeof res.access_token === 'string' && res.access_token ? res.access_token : token; // a token of another app can't be exchanged: keep it
}

/** Every row of a Graph list, following paging.next (bounded). */
async function graphList(path: string, token: string, params: Record<string, string>): Promise<{ data: Record<string, any>[]; error?: string }> {
  const data: Record<string, any>[] = [];
  let res = await graph('GET', path, token, { ...params, limit: '100' });
  for (let i = 0; i < 50; i++) {
    if (res.error) return { data, error: String(res.error.message ?? 'unknown error') };
    data.push(...((res.data ?? []) as Record<string, any>[]));
    const next = res.paging?.next;
    if (!next) break;
    try { res = await (await fetch(String(next), { signal: AbortSignal.timeout(30_000) })).json(); } catch (e) { res = { error: { message: e instanceof Error ? e.message : String(e) } }; }
  }
  return { data };
}

export interface TokenPages {
  kind: 'page' | 'user';
  owner: string;                                  // the Page / person / System User the token belongs to
  pages: FbPageToken[];                           // can post
  skipped: { name: string; reason: string }[];    // seen, but can't post
  missingPermissions: string[];
}

const NEEDED = ['pages_show_list', 'pages_manage_posts', 'pages_read_engagement'];

/**
 * The Pages a token can post to. A Page token gives its own Page; a user or System User token
 * (an agency managing many Pages) gives every Page it can post to, each with its own Page token:
 * the Pages listed for the person (me/accounts) and, with business_management, the Pages its
 * Business accounts own or manage for clients.
 */
export async function pagesForToken(token: string): Promise<({ ok: true } & TokenPages) | { ok: false; error: string }> {
  const me = await graph('GET', 'me', token, { fields: 'id,name', metadata: '1' });
  if (me.error || !me.id) return { ok: false, error: `Facebook refused the token: ${me.error?.message ?? 'unknown error'}` };
  const owner = String(me.name ?? me.id);
  if (me.metadata?.type === 'page') return { ok: true, kind: 'page', owner, pages: [{ id: String(me.id), name: owner, token }], skipped: [], missingPermissions: [] };

  const userToken = await longLived(token);
  const perms = await graph('GET', 'me/permissions', userToken);
  const granted = new Set(((perms.data ?? []) as { permission: string; status: string }[]).filter((p) => p.status === 'granted').map((p) => p.permission));
  const missingPermissions = perms.error ? [] : NEEDED.filter((p) => !granted.has(p));

  const pages = new Map<string, FbPageToken>();
  const skipped = new Map<string, { name: string; reason: string }>();
  const take = (pg: Record<string, any>, via: string) => {
    const id = String(pg.id);
    if (pages.has(id)) return;
    const name = String(pg.name ?? id);
    if (!pg.access_token) { skipped.set(id, { name, reason: `${via}: no posting access for this login (assign the Page to it with Content / Full control)` }); return; }
    // tasks is missing for some System User tokens; when present, posting needs CREATE_CONTENT
    if (Array.isArray(pg.tasks) && !pg.tasks.includes('CREATE_CONTENT')) { skipped.set(id, { name, reason: `${via}: access without “Create content” (${pg.tasks.join(', ').toLowerCase() || 'none'})` }); return; }
    pages.set(id, { id, name, token: String(pg.access_token) });
    skipped.delete(id);
  };

  const mine = await graphList('me/accounts', userToken, { fields: 'id,name,access_token,tasks' });
  if (mine.error) return { ok: false, error: `Facebook did not list the Pages of this token: ${mine.error}. Add the pages_show_list permission.` };
  mine.data.forEach((pg) => take(pg, 'your Pages'));

  // Agency: Pages owned by / shared (Partner) with the Business accounts; needs business_management
  const businesses = await graphList('me/businesses', userToken, { fields: 'id,name' });
  for (const b of businesses.error ? [] : businesses.data.slice(0, 20)) {
    for (const edge of ['owned_pages', 'client_pages'] as const) {
      const list = await graphList(`${b.id}/${edge}`, userToken, { fields: 'id,name,access_token,tasks' });
      for (const pg of list.data) {
        if (pages.has(String(pg.id))) continue;
        let row = pg;
        if (!pg.access_token) { // the edge may omit it: ask the Page itself
          const one = await graph('GET', String(pg.id), userToken, { fields: 'id,name,access_token' });
          if (!one.error && one.access_token) row = { ...pg, access_token: one.access_token };
        }
        take(row, `${b.name ?? 'Business'} (${edge === 'owned_pages' ? 'owned' : 'client'})`);
      }
    }
  }

  if (!pages.size) {
    const why = missingPermissions.length ? ` The token is missing: ${missingPermissions.join(', ')}.` : '';
    const seen = skipped.size ? ` Pages seen but not usable: ${[...skipped.values()].slice(0, 10).map((s) => `${s.name} (${s.reason})`).join('; ')}.` : '';
    return { ok: false, error: `The token of “${owner}” gives no Page to post to.${why}${seen} The person must have Content access to the Pages and pick them when creating the token (for a System User: Assign assets in Business Settings).` };
  }
  return { ok: true, kind: 'user', owner, pages: [...pages.values()], skipped: [...skipped.values()], missingPermissions };
}

// ------------------------------------------------------------------ CSV

export interface CsvPost { line: number; message: string; link: string; image: string; scheduledAt: number }

/** RFC 4180 CSV: quoted fields may hold commas, quotes ("") and new lines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const COLUMNS: Record<keyof Omit<CsvPost, 'line' | 'scheduledAt'> | 'schedule', string[]> = {
  message: ['message', 'text', 'caption', 'post', 'content'],
  link: ['link', 'url', 'link_url', 'website'],
  image: ['image', 'image_url', 'photo', 'photo_url', 'picture', 'media_url'],
  schedule: ['schedule', 'scheduled_at', 'schedule_time', 'publish_at', 'date', 'datetime', 'time'],
};

/** CSV text → posts to queue, and the problems of the rows that were skipped. */
export function postsFromCsv(text: string, start: number): { posts: CsvPost[]; errors: string[] } {
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ''));
  if (rows.length < 2) return { posts: [], errors: ['The file has no posts: the first row must be the headings (message, image_url, link, schedule) and each next row one post.'] };
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const col = (k: keyof typeof COLUMNS) => head.findIndex((h) => COLUMNS[k].includes(h));
  const idx = { message: col('message'), link: col('link'), image: col('image'), schedule: col('schedule') };
  if (idx.message < 0 && idx.image < 0) return { posts: [], errors: ['No "message" or "image_url" column found in the first row.'] };
  const posts: CsvPost[] = [];
  const errors: string[] = [];
  const t = now();
  rows.slice(1, MAX_CSV_ROWS + 1).forEach((r, i) => {
    const line = i + 2;
    const get = (j: number) => (j >= 0 ? String(r[j] ?? '').trim() : '');
    const message = get(idx.message).slice(0, 60000);
    const link = get(idx.link);
    const image = get(idx.image);
    const when = get(idx.schedule);
    if (!message && !image) { errors.push(`Line ${line}: no message and no image.`); return; }
    if (link && !/^https?:\/\/\S+$/i.test(link)) { errors.push(`Line ${line}: the link must start with https://`); return; }
    if (image && !/^https?:\/\/\S+$/i.test(image)) { errors.push(`Line ${line}: the image_url must be a public https:// link (upload images in Media Library to get one).`); return; }
    let scheduledAt = start;
    if (when) {
      const ts = parseDate(when.replace(/\s+/g, ' '));
      if (!ts) { errors.push(`Line ${line}: "${when}" is not a date; use 25-11-2026 10:30 or 2026-11-25 10:30.`); return; }
      if (ts < t - 3600) { errors.push(`Line ${line}: ${when} is in the past.`); return; }
      scheduledAt = Math.max(ts, start);
    }
    posts.push({ line, message, link, image, scheduledAt });
  });
  if (rows.length - 1 > MAX_CSV_ROWS) errors.push(`Only the first ${MAX_CSV_ROWS} posts were read; split bigger files.`);
  return { posts, errors };
}

// ------------------------------------------------------------------ publishing (worker)

/** Publish the posts that are due (a few per run, one after another), then record the Facebook id or the error. */
export async function publishDuePosts(log: (m: string) => void = () => {}): Promise<number> {
  const t = now();
  // A post stuck in "Posting" (worker stopped mid-way): Facebook may or may not have it, so don't post twice
  await exec(`UPDATE js_fb_post SET po_status = 4, po_error = 'Interrupted while posting; check the Page before retrying.'
               WHERE po_status = 2 AND po_posted_on > 0 AND po_posted_on < $1`, [t - 900]);
  const due = await query<{ po_id: number; po_message: string; po_link: string; po_image_url: string; fp_page_id: string; fp_token: string }>(
    `UPDATE js_fb_post p SET po_status = 2, po_posted_on = $1
       FROM js_fb_page f
      WHERE p.po_id IN (SELECT po_id FROM js_fb_post WHERE po_status = 1 AND po_scheduled_at <= $1 ORDER BY po_scheduled_at, po_id LIMIT ${PER_RUN} FOR UPDATE SKIP LOCKED)
        AND f.fp_id = p.po_page_id
      RETURNING p.po_id, p.po_message, p.po_link, p.po_image_url, f.fp_page_id, f.fp_token`, [t]);
  let posted = 0;
  for (const p of due) {
    const res = p.po_image_url
      ? await graph('POST', `${p.fp_page_id}/photos`, p.fp_token, { url: p.po_image_url, caption: [p.po_message, p.po_link].filter(Boolean).join('\n\n') })
      : await graph('POST', `${p.fp_page_id}/feed`, p.fp_token, { message: p.po_message, ...(p.po_link ? { link: p.po_link } : {}) });
    const id = String(res.post_id ?? res.id ?? '');
    if (res.error || !id) {
      await exec('UPDATE js_fb_post SET po_status = 4, po_error = $2, po_posted_on = $3 WHERE po_id = $1',
        [p.po_id, String(res.error?.message ?? 'Facebook did not return a post id.').slice(0, 1000), now()]);
    } else {
      await exec("UPDATE js_fb_post SET po_status = 3, po_fb_id = $2, po_error = '', po_posted_on = $3 WHERE po_id = $1", [p.po_id, id, now()]);
      posted++;
    }
    await new Promise((r) => setTimeout(r, 1500)); // stay well under Facebook's rate limits
  }
  if (due.length) log(`fb-posts: ${posted} posted, ${due.length - posted} failed`);
  return posted;
}
