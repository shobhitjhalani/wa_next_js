'use server';

import { notFound, redirect } from 'next/navigation';
import { flash, type ActionResult } from '@/lib/actions';
import { requireUser } from '@/lib/auth';
import { exec, one, query, value } from '@/lib/db';
import { isQrMatch, isQrType, matchLabel, qrKeywords, QR_LIMITS, sanitizeData, validateReply } from '@/lib/quick-reply';
import { now } from '@/lib/time';

/** Quick Replies: save from the editor, switch on / off, duplicate, delete. */

/** Only back to the quick replies list (keeps its search / page). */
const safeBack = (back: string) => (/^\/quick_replies(\?[^#\s]*)?$/.test(back) ? back : '/quick_replies');

/** Save a new (id null) or existing quick reply. Field errors come back as `errors`; on success back to the list. */
export async function saveQuickReply(id: number | null, input: {
  name: string; keywords: string; match: number; type: string; data: unknown; active: boolean;
}): Promise<ActionResult> {
  const user = await requireUser();
  const name = String(input.name ?? '').trim().slice(0, QR_LIMITS.name);
  const keywords = qrKeywords(String(input.keywords ?? ''));
  const type = isQrType(input.type) ? input.type : 'text';
  const match = isQrMatch(input.match) ? Number(input.match) : 1;
  const data = sanitizeData(type, input.data);
  const errors = validateReply({ name, keywords, type, data });
  if (Object.keys(errors).length) return { ok: false, error: 'Please fix the highlighted fields.', errors };

  const t = now();
  const status = input.active ? 1 : 2;
  let saved: number | null;
  if (id) {
    saved = await value<number>(
      `UPDATE js_quick_reply SET qr_name = $3, qr_keywords = $4::text[], qr_match = $5, qr_type = $6, qr_data = $7::jsonb, qr_status = $8, qr_updated_on = $9
        WHERE qr_id = $1 AND qr_user_id = $2 RETURNING qr_id`,
      [id, user.u_id, name, keywords, match, type, JSON.stringify(data), status, t]);
    if (!saved) notFound();
  } else {
    saved = await value<number>(
      `INSERT INTO js_quick_reply (qr_user_id, qr_name, qr_keywords, qr_match, qr_type, qr_data, qr_status, qr_created_on, qr_updated_on)
       VALUES ($1, $2, $3::text[], $4, $5, $6::jsonb, $7, $8, $8) RETURNING qr_id`,
      [user.u_id, name, keywords, match, type, JSON.stringify(data), status, t]);
  }

  // Not errors, but worth knowing: the same keyword in another active quick reply / an active chatbot flow
  const notes: string[] = [];
  if (status === 1) {
    const twin = await one<{ qr_name: string; k: string }>(
      `SELECT qr_name, k FROM js_quick_reply, unnest(qr_keywords) k
        WHERE qr_user_id = $1 AND qr_id <> $2 AND qr_status = 1 AND qr_match = $3 AND k = ANY($4::text[]) LIMIT 1`,
      [user.u_id, saved, match, keywords]);
    if (twin) notes.push(`The keyword “${twin.k}” (${matchLabel(match).toLowerCase()}) is also used by “${twin.qr_name}”: the newer quick reply answers.`);
    const flow = await one<{ bf_name: string; k: string }>(
      `SELECT bf_name, k FROM js_bot_flow, unnest(bf_keywords) k WHERE bf_user_id = $1 AND bf_status = 1 AND k = ANY($2::text[]) LIMIT 1`,
      [user.u_id, keywords]);
    if (flow) notes.push(`The keyword “${flow.k}” starts the chatbot flow “${flow.bf_name}”, which answers before quick replies.`);
  }
  await flash('success', [`Quick reply “${name}” saved${status === 1 ? '' : ' (switched off)'}.`, ...notes].join(' '));
  redirect('/quick_replies');
}

export async function setQuickReplyStatus(id: number, active: boolean, back: string): Promise<void> {
  const user = await requireUser();
  const name = await value<string>(
    'UPDATE js_quick_reply SET qr_status = $3, qr_updated_on = $4 WHERE qr_id = $1 AND qr_user_id = $2 RETURNING qr_name', [id, user.u_id, active ? 1 : 2, now()]);
  if (name === null) notFound();
  await flash('success', `“${name}” is ${active ? 'on' : 'off'}.`);
  redirect(safeBack(back));
}

export async function duplicateQuickReply(id: number): Promise<void> {
  const user = await requireUser();
  const t = now();
  const newId = await value<number>(
    `INSERT INTO js_quick_reply (qr_user_id, qr_name, qr_keywords, qr_match, qr_type, qr_data, qr_status, qr_created_on, qr_updated_on)
     SELECT qr_user_id, left(qr_name, 92) || ' (copy)', qr_keywords, qr_match, qr_type, qr_data, 2, $3, $3
       FROM js_quick_reply WHERE qr_id = $1 AND qr_user_id = $2 RETURNING qr_id`, [id, user.u_id, t]);
  if (!newId) notFound();
  await flash('success', 'Quick reply duplicated (switched off until you save it on).');
  redirect(`/quick_replies/${newId}`);
}

export async function deleteQuickReply(id: number, back: string): Promise<void> {
  const user = await requireUser();
  await exec('DELETE FROM js_quick_reply WHERE qr_id = $1 AND qr_user_id = $2', [id, user.u_id]);
  await flash('success', 'Quick reply deleted.');
  redirect(safeBack(back));
}

/** Which active quick reply would answer a message (the “Try a message” box). */
export async function tryMessage(text: string): Promise<{ id: number; name: string; keyword: string } | null> {
  const user = await requireUser();
  const { pickReply, keywordMatches } = await import('@/lib/quick-reply');
  const rows = await query<{ qr_id: number; qr_name: string; qr_keywords: string[]; qr_match: number }>(
    'SELECT qr_id, qr_name, qr_keywords, qr_match FROM js_quick_reply WHERE qr_user_id = $1 AND qr_status = 1', [user.u_id]);
  const hit = pickReply(rows.map((r) => ({ ...r, id: r.qr_id, keywords: r.qr_keywords ?? [], match: Number(r.qr_match) })), String(text ?? '').slice(0, 4096));
  if (!hit) return null;
  return { id: hit.qr_id, name: hit.qr_name, keyword: hit.keywords.find((k) => keywordMatches(text, k, hit.match)) ?? '' };
}
