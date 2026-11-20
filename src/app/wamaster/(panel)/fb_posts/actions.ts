'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { fail, fFile, fInt, flash, fStr, invalid, ok, type ActionResult } from '@/lib/actions';
import { requireRight } from '@/lib/admin-access';
import { exec, insertMany, one, tx } from '@/lib/db';
import { checkPageToken, postsFromCsv } from '@/lib/services/fb-posts';
import { now, parseDate } from '@/lib/time';

/** Connect a Facebook Page by its Page access token (optionally for a client account). */
export async function addPage(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { admin } = await requireRight('fb_posts', 'add');
  const token = fStr(fd, 'token');
  const userId = fInt(fd, 'user_id');
  if (token.length < 50) return invalid({ token: 'Paste the Page access token (a long text starting with EAA…).' });
  const page = await checkPageToken(token);
  if (!page.ok) return invalid({ token: page.error });
  await exec(
    `INSERT INTO js_fb_page (fp_page_id, fp_name, fp_token, fp_user_id, fp_emp_id, fp_created_on) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (fp_page_id) DO UPDATE SET fp_name = EXCLUDED.fp_name, fp_token = EXCLUDED.fp_token, fp_user_id = EXCLUDED.fp_user_id`,
    [page.id, page.name, token, userId, admin.emp_id, now()]);
  revalidatePath('/wamaster/fb_posts/pages');
  return ok(`Page “${page.name}” connected.`);
}

export async function deletePage(id: number): Promise<void> {
  await requireRight('fb_posts', 'delete');
  const row = await one<{ fp_name: string }>('DELETE FROM js_fb_page WHERE fp_id = $1 RETURNING fp_name', [id]);
  await flash(row ? 'success' : 'error', row ? `Page “${row.fp_name}” removed with its post history.` : 'This Page no longer exists.');
  revalidatePath('/wamaster/fb_posts/pages');
}

/** Upload a CSV of posts for a Page: valid rows are queued, skipped rows are listed. */
export async function uploadPosts(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { admin } = await requireRight('fb_posts', 'add');
  const pageId = fInt(fd, 'page_id');
  const file = fFile(fd, 'csv');
  const startRaw = fStr(fd, 'start');
  const errors: Record<string, string> = {};
  if (!(await one('SELECT 1 FROM js_fb_page WHERE fp_id = $1', [pageId]))) errors.page_id = 'Choose the Facebook Page to post to.';
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
  const batchId = await tx(async (db) => {
    const b = await one<{ pb_id: number }>(
      'INSERT INTO js_fb_post_batch (pb_page_id, pb_file, pb_total, pb_emp_id, pb_created_on) VALUES ($1, $2, $3, $4, $5) RETURNING pb_id',
      [pageId, file!.name.slice(0, 200), posts.length, admin.emp_id, now()], db);
    await insertMany('js_fb_post', posts.map((p) => ({
      po_batch_id: b!.pb_id, po_line: p.line, po_message: p.message, po_link: p.link, po_image_url: p.image, po_scheduled_at: p.scheduledAt,
    })), { db });
    return b!.pb_id;
  });
  await flash(skipped.length ? 'error' : 'success', skipped.length
    ? `${posts.length} post(s) queued; ${skipped.length} row(s) skipped:\n${skipped.slice(0, 15).join('\n')}`
    : `${posts.length} post(s) queued. They are published one by one; this page shows each result.`);
  redirect(`/wamaster/fb_posts/${batchId}`);
}

/** Queue the failed posts of a batch again. */
export async function retryFailed(batchId: number): Promise<void> {
  await requireRight('fb_posts', 'add');
  const n = await exec("UPDATE js_fb_post SET po_status = 1, po_error = '', po_scheduled_at = $2, po_posted_on = 0 WHERE po_batch_id = $1 AND po_status = 4", [batchId, now()]);
  await flash('success', `${n} failed post(s) queued again.`);
  revalidatePath(`/wamaster/fb_posts/${batchId}`);
}

/** Stop the posts of a batch that are not published yet. */
export async function cancelQueued(batchId: number): Promise<void> {
  await requireRight('fb_posts', 'add');
  const n = await exec('UPDATE js_fb_post SET po_status = 5 WHERE po_batch_id = $1 AND po_status = 1', [batchId]);
  await flash('success', `${n} queued post(s) cancelled.`);
  revalidatePath(`/wamaster/fb_posts/${batchId}`);
}
