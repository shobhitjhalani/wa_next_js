'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { fail, fFile, fInt, flash, fStr, invalid, ok, type ActionResult } from '@/lib/actions';
import { requireRight, requireSuperAdmin } from '@/lib/admin-access';
import { exec, insertMany, one, query, tx } from '@/lib/db';
import { MAX_UPLOAD_POSTS, pagesForToken, postsFromCsv, refreshPages, saveTokenPages } from '@/lib/services/fb-posts';
import { now, parseDate } from '@/lib/time';

/** Connect Facebook Pages: a Page token connects its Page, a user / System User token every Page it manages. */
export async function addPage(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { admin } = await requireSuperAdmin();
  const token = fStr(fd, 'token').replace(/\s+/g, '');
  const userId = fInt(fd, 'user_id');
  if (token.length < 50) return invalid({ token: 'Paste the access token (a long text starting with EAA…).' });
  const res = await pagesForToken(token);
  if (!res.ok) return invalid({ token: res.error });
  await saveTokenPages(res, { userId, empId: admin.emp_id });
  revalidatePath('/wamaster/fb_posts/pages');
  revalidatePath('/wamaster/fb_posts');
  const names = res.pages.map((p) => p.name);
  const lines = [
    res.kind === 'page'
      ? `Page “${names[0]}” connected. This was a Page token, so only this Page was added; paste a User or System User token to add all your Pages at once.`
      : `Token of “${res.owner}”: ${names.length} Page(s) connected: ${names.slice(0, 30).join(', ')}${names.length > 30 ? ` and ${names.length - 30} more` : ''}.`,
  ];
  if (res.skipped.length) lines.push(`Not connected (${res.skipped.length}): ${res.skipped.slice(0, 15).map((s) => `${s.name} – ${s.reason}`).join('; ')}.`);
  if (res.missingPermissions.length) lines.push(`The token is missing ${res.missingPermissions.join(', ')}: posting may fail.`);
  if (res.kind === 'user' && names.length === 1) {
    lines.push('Only one Page? When creating the token, Facebook asks which Pages to allow: choose all of them (or use a System User with the Pages assigned).');
  }
  return ok(lines.join('\n'));
}

/** "Refresh Pages": list the Pages again with every kept token and check each Page's token. */
export async function refreshPagesAction(): Promise<void> {
  const { admin } = await requireSuperAdmin();
  const r = await refreshPages(admin.emp_id);
  const lines = [`Checked ${r.tokens} token(s) and ${r.checked} Page(s)${r.added ? `; ${r.added} new Page(s) added` : '; no new Pages'}.`];
  if (r.tokenProblems.length) lines.push(`Token problems:\n${r.tokenProblems.slice(0, 10).join('\n')}`);
  if (r.problems.length) lines.push(`Pages with problems (${r.problems.length}):\n${r.problems.slice(0, 15).join('\n')}`);
  if (!r.tokens) lines.push('No token is kept yet: paste a User or System User token once and later refreshes find new Pages with it.');
  await flash(r.tokenProblems.length || r.problems.length ? 'error' : 'success', lines.join('\n'));
  revalidatePath('/wamaster/fb_posts/pages');
  revalidatePath('/wamaster/fb_posts');
}

/** Forget a kept token (its Pages stay connected with their own Page tokens). */
export async function deleteToken(id: number): Promise<void> {
  await requireSuperAdmin();
  const row = await one<{ ft_name: string }>('DELETE FROM js_fb_token WHERE ft_id = $1 RETURNING ft_name', [id]);
  await flash(row ? 'success' : 'error', row ? `Token of “${row.ft_name}” removed. Its Pages stay connected; Refresh no longer uses it to find new Pages.` : 'This token no longer exists.');
  revalidatePath('/wamaster/fb_posts/pages');
}

/** Uploads left without posts are dropped; the totals of the others are corrected (after Pages are removed). */
async function tidyBatches(): Promise<void> {
  await exec('DELETE FROM js_fb_post_batch b WHERE NOT EXISTS (SELECT 1 FROM js_fb_post p WHERE p.po_batch_id = b.pb_id)');
  await exec('UPDATE js_fb_post_batch b SET pb_total = c.n FROM (SELECT po_batch_id, COUNT(*)::int AS n FROM js_fb_post GROUP BY po_batch_id) c WHERE c.po_batch_id = b.pb_id AND b.pb_total <> c.n');
}

export async function deletePage(id: number): Promise<void> {
  await requireSuperAdmin();
  const row = await one<{ fp_name: string }>('DELETE FROM js_fb_page WHERE fp_id = $1 RETURNING fp_name', [id]);
  await tidyBatches();
  await flash(row ? 'success' : 'error', row ? `Page “${row.fp_name}” removed with its post history.` : 'This Page no longer exists.');
  revalidatePath('/wamaster/fb_posts/pages');
  revalidatePath('/wamaster/fb_posts');
}

/** Remove the ticked Pages (with their queued posts and history here; posts already on Facebook stay). */
export async function deletePages(fd: FormData): Promise<void> {
  await requireSuperAdmin();
  const ids = [...new Set(fd.getAll('ids').map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) {
    await flash('error', 'Tick the Pages to remove first.');
  } else {
    const rows = await query<{ fp_name: string }>('DELETE FROM js_fb_page WHERE fp_id = ANY($1::int[]) RETURNING fp_name', [ids]);
    await tidyBatches();
    const names = rows.map((r) => r.fp_name);
    await flash('success', `${names.length} Page(s) removed with their post history: ${names.slice(0, 20).join(', ')}${names.length > 20 ? ` and ${names.length - 20} more` : ''}.`);
  }
  revalidatePath('/wamaster/fb_posts/pages');
  revalidatePath('/wamaster/fb_posts');
}

/** Upload a CSV of posts for one or more Pages: each valid row is queued once per Page, skipped rows are listed. */
export async function uploadPosts(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { admin } = await requireRight('fb_posts', 'add');
  const wanted = [...new Set(fd.getAll('page_ids').map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const file = fFile(fd, 'csv');
  const startRaw = fStr(fd, 'start');
  const errors: Record<string, string> = {};
  const pageIds = wanted.length
    ? (await query<{ fp_id: number }>('SELECT fp_id FROM js_fb_page WHERE fp_id = ANY($1::int[]) ORDER BY lower(fp_name)', [wanted])).map((r) => r.fp_id)
    : [];
  if (!pageIds.length) errors.page_ids = 'Tick at least one Facebook Page to post to.';
  if (!file) errors.csv = 'Choose the CSV file.';
  else if (!/\.csv$/i.test(file.name)) errors.csv = 'Upload a .csv file (in Excel: File → Save As → CSV UTF-8).';
  else if (file.size > 5 * 1048576) errors.csv = 'The CSV may be at most 5 MB.';
  let start = now();
  if (startRaw) {
    const t = parseDate(startRaw);
    if (!t) errors.start = 'Enter a valid date and time.';
    else start = Math.max(t, now());
  }
  if (Object.keys(errors).length) return invalid(errors);

  const { posts, errors: skipped } = postsFromCsv(await file!.text(), start);
  if (!posts.length) return fail(['No post could be queued.', ...skipped.slice(0, 15)].join('\n'));
  const total = posts.length * pageIds.length;
  if (total > MAX_UPLOAD_POSTS) {
    return fail(`${posts.length} post(s) × ${pageIds.length} Page(s) = ${total} posts; one upload may queue at most ${MAX_UPLOAD_POSTS}. Tick fewer Pages or split the file.`);
  }
  const batchId = await tx(async (db) => {
    const b = await one<{ pb_id: number }>(
      'INSERT INTO js_fb_post_batch (pb_page_id, pb_file, pb_total, pb_emp_id, pb_created_on, pb_status) VALUES (NULL, $1, $2, $3, $4, 0) RETURNING pb_id',
      [file!.name.slice(0, 200), total, admin.emp_id, now()], db);
    // Row by row, each to every Page: the same post reaches all Pages close together
    await insertMany('js_fb_post', posts.flatMap((p) => pageIds.map((pageId) => ({
      po_batch_id: b!.pb_id, po_page_id: pageId, po_line: p.line, po_message: p.message, po_link: p.link, po_image_url: p.image, po_scheduled_at: p.scheduledAt, po_status: 0,
    }))), { db });
    return b!.pb_id;
  });
  const ready = pageIds.length > 1 ? `${posts.length} post(s) × ${pageIds.length} Pages = ${total} posts ready` : `${posts.length} post(s) ready`;
  await flash(skipped.length ? 'error' : 'success', skipped.length
    ? `${ready}; ${skipped.length} row(s) skipped:\n${skipped.slice(0, 15).join('\n')}\nCheck the preview, then Confirm & queue.`
    : `${ready}. Check the preview, then Confirm & queue: nothing is posted before that.`);
  redirect(`/wamaster/fb_posts/${batchId}`);
}

/** Preview checked: queue the draft posts (an empty schedule = from now). */
export async function confirmBatch(batchId: number): Promise<void> {
  await requireRight('fb_posts', 'add');
  const t = now();
  const n = await tx(async (db) => {
    const b = await one('UPDATE js_fb_post_batch SET pb_status = 1 WHERE pb_id = $1 AND pb_status = 0 RETURNING pb_id', [batchId], db);
    if (!b) return -1;
    return exec('UPDATE js_fb_post SET po_status = 1, po_scheduled_at = GREATEST(po_scheduled_at, $2) WHERE po_batch_id = $1 AND po_status = 0', [batchId, t], db);
  });
  await flash(n < 0 ? 'error' : 'success', n < 0 ? 'This upload was already confirmed or discarded.' : `${n} post(s) queued. They are published one by one; this page shows each result.`);
  revalidatePath(`/wamaster/fb_posts/${batchId}`);
  revalidatePath('/wamaster/fb_posts');
}

/** Preview not wanted: delete the draft upload. */
export async function discardBatch(batchId: number): Promise<void> {
  await requireRight('fb_posts', 'add');
  const row = await one<{ pb_file: string }>('DELETE FROM js_fb_post_batch WHERE pb_id = $1 AND pb_status = 0 RETURNING pb_file', [batchId]);
  await flash(row ? 'success' : 'error', row ? `Draft “${row.pb_file}” discarded; nothing was posted.` : 'This upload was already confirmed or discarded.');
  revalidatePath('/wamaster/fb_posts');
  redirect('/wamaster/fb_posts');
}

/** Queue the failed posts of a batch again (of one Page when pageId is set). */
export async function retryFailed(batchId: number, pageId = 0): Promise<void> {
  await requireRight('fb_posts', 'add');
  const n = await exec(
    `UPDATE js_fb_post SET po_status = 1, po_error = '', po_scheduled_at = $2, po_posted_on = 0
      WHERE po_batch_id = $1 AND po_status = 4 AND ($3::int = 0 OR po_page_id = $3)`, [batchId, now(), pageId]);
  await flash('success', `${n} failed post(s) queued again.`);
  revalidatePath(`/wamaster/fb_posts/${batchId}`);
}

/** Stop the posts of a batch that are not published yet (of one Page when pageId is set). */
export async function cancelQueued(batchId: number, pageId = 0): Promise<void> {
  await requireRight('fb_posts', 'add');
  const n = await exec('UPDATE js_fb_post SET po_status = 5 WHERE po_batch_id = $1 AND po_status = 1 AND ($2::int = 0 OR po_page_id = $2)', [batchId, pageId]);
  await flash('success', `${n} queued post(s) cancelled.`);
  revalidatePath(`/wamaster/fb_posts/${batchId}`);
}
