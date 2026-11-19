'use server';

import { requireUser } from '@/lib/auth';
import { labelColor, MAX_LABEL_NAME, MAX_LABELS, type ChatLabel } from '@/lib/chat-labels';
import { exec, one, query, value } from '@/lib/db';
import { now } from '@/lib/time';
import { normalizePhone } from '@/lib/phone';
import { after } from 'next/server';
import { clearAllUnread, cleanMobile, markAllMessagesRead, unreadTotal } from './inbox';

/** Inbox: "Mark all read" and chat labels (create / edit / delete, put on or take off a chat). */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Every unread incoming message in every chat → read: the counts at once, the messages in batches afterwards. */
export async function markAllChatsRead(): Promise<Result<{ marked: number; unread: number }>> {
  const user = await requireUser();
  const marked = await clearAllUnread(user.u_id);
  after(() => markAllMessagesRead(user.u_id).catch((e) => console.error('[chat] mark all read failed', user.u_id, e)));
  return { ok: true, marked, unread: await unreadTotal(user.u_id) };
}

/** "New chat": the typed number in the form conversations are stored (no home country code), or why it is not a mobile number. */
export async function newChatNumber(raw: string): Promise<Result<{ mobile: string }>> {
  await requireUser();
  const mobile = normalizePhone(raw);
  return mobile ? { ok: true, mobile } : { ok: false, error: 'Enter a valid mobile number, e.g. 9876543210 or +44 7911 123456.' };
}

/** The account's labels, A–Z, with how many chats have each. */
export async function chatLabels(): Promise<ChatLabel[]> {
  const user = await requireUser();
  return listLabels(user.u_id);
}

async function listLabels(userId: number): Promise<ChatLabel[]> {
  const rows = await query<{ id: number; name: string; color: string; count: number }>(
    `SELECT l.lb_id AS id, l.lb_name AS name, l.lb_color AS color,
            (SELECT COUNT(*)::int FROM js_chat_label_contact c WHERE c.lc_label_id = l.lb_id) AS count
       FROM js_chat_label l WHERE l.lb_user_id = $1 ORDER BY lower(l.lb_name)`, [userId]);
  return rows.map((r) => ({ ...r, color: labelColor(r.color) }));
}

function cleanName(name: unknown): string | null {
  const v = String(name ?? '').replace(/\s+/g, ' ').trim();
  return v && Array.from(v).length <= MAX_LABEL_NAME ? v : null;
}

/** New label; with `mobile` it is put on that chat straight away. */
export async function createChatLabel(name: string, color: string, mobile?: string): Promise<Result<{ labels: ChatLabel[]; id: number }>> {
  const user = await requireUser();
  const n = cleanName(name);
  if (!n) return { ok: false, error: `Enter a label name (up to ${MAX_LABEL_NAME} characters).` };
  if (((await value<number>('SELECT COUNT(*)::int FROM js_chat_label WHERE lb_user_id = $1', [user.u_id])) ?? 0) >= MAX_LABELS) {
    return { ok: false, error: `You can have up to ${MAX_LABELS} labels.` };
  }
  if (await value('SELECT 1 FROM js_chat_label WHERE lb_user_id = $1 AND lower(lb_name) = lower($2)', [user.u_id, n])) {
    return { ok: false, error: `You already have a label “${n}”.` };
  }
  const id = (await value<number>('INSERT INTO js_chat_label (lb_user_id, lb_name, lb_color, lb_created_on) VALUES ($1, $2, $3, $4) RETURNING lb_id',
    [user.u_id, n, labelColor(color), now()]))!;
  if (mobile) await toggle(user.u_id, cleanMobile(mobile), id, true);
  return { ok: true, id, labels: await listLabels(user.u_id) };
}

export async function updateChatLabel(id: number, name: string, color: string): Promise<Result<{ labels: ChatLabel[] }>> {
  const user = await requireUser();
  const n = cleanName(name);
  if (!n) return { ok: false, error: `Enter a label name (up to ${MAX_LABEL_NAME} characters).` };
  if (await value('SELECT 1 FROM js_chat_label WHERE lb_user_id = $1 AND lower(lb_name) = lower($2) AND lb_id <> $3', [user.u_id, n, id])) {
    return { ok: false, error: `You already have a label “${n}”.` };
  }
  await exec('UPDATE js_chat_label SET lb_name = $3, lb_color = $4 WHERE lb_id = $1 AND lb_user_id = $2', [id, user.u_id, n, labelColor(color)]);
  return { ok: true, labels: await listLabels(user.u_id) };
}

/** Delete a label; it comes off every chat. */
export async function deleteChatLabel(id: number): Promise<Result<{ labels: ChatLabel[] }>> {
  const user = await requireUser();
  await exec('DELETE FROM js_chat_label WHERE lb_id = $1 AND lb_user_id = $2', [id, user.u_id]);
  return { ok: true, labels: await listLabels(user.u_id) };
}

/** Put a label on a chat, or take it off. Returns the chat's labels. */
export async function setChatLabel(mobile: string, labelId: number, on: boolean): Promise<Result<{ chat: number[]; labels: ChatLabel[] }>> {
  const user = await requireUser();
  const chat = await toggle(user.u_id, cleanMobile(mobile), labelId, on);
  if (!chat) return { ok: false, error: 'This chat can not be labelled yet.' };
  return { ok: true, chat, labels: await listLabels(user.u_id) };
}

async function toggle(userId: number, mobile: string, labelId: number, on: boolean): Promise<number[] | null> {
  const contact = await one<{ cl_id: number }>('SELECT cl_id FROM js_user_contact_list WHERE cl_user_id = $1 AND cl_mobile_no = $2', [userId, mobile]);
  const label = await value('SELECT 1 FROM js_chat_label WHERE lb_id = $1 AND lb_user_id = $2', [labelId, userId]);
  if (!contact || !label) return null;
  if (on) {
    await exec('INSERT INTO js_chat_label_contact (lc_label_id, lc_contact_id, lc_created_on) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [labelId, contact.cl_id, now()]);
  } else {
    await exec('DELETE FROM js_chat_label_contact WHERE lc_label_id = $1 AND lc_contact_id = $2', [labelId, contact.cl_id]);
  }
  // Touch the chat so other open inbox tabs pick the change up on their next poll
  await exec('UPDATE js_user_contact_list SET cl_updated_on = now() WHERE cl_id = $1', [contact.cl_id]);
  return (await query<{ id: number }>('SELECT lc_label_id AS id FROM js_chat_label_contact WHERE lc_contact_id = $1 ORDER BY lc_label_id', [contact.cl_id])).map((r) => r.id);
}
