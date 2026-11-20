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

/** Check a Page access token: the Page it belongs to, or why it can't be used. */
export async function checkPageToken(token: string): Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }> {
  const me = await graph('GET', 'me', token, { fields: 'id,name' });
  if (me.error || !me.id) return { ok: false, error: `Facebook refused the token: ${me.error?.message ?? 'no Page found'}` };
  // A user token answers too, but it can't post as the Page
  const page = await graph('GET', String(me.id), token, { fields: 'id,name,category' });
  if (page.error || !page.category) return { ok: false, error: 'This is not a Page access token. Create one for the Page (with pages_manage_posts) and paste it.' };
  return { ok: true, id: String(me.id), name: String(me.name ?? '') };
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
       FROM js_fb_post_batch b, js_fb_page f
      WHERE p.po_id IN (SELECT po_id FROM js_fb_post WHERE po_status = 1 AND po_scheduled_at <= $1 ORDER BY po_scheduled_at, po_id LIMIT ${PER_RUN} FOR UPDATE SKIP LOCKED)
        AND b.pb_id = p.po_batch_id AND f.fp_id = b.pb_page_id
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
