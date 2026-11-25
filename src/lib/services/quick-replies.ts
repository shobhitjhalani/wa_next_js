import 'server-only';
import { exec, query } from '../db';
import { contactId, recordMessage } from '../models';
import { fillVars, keywordMatches, pickReply, sanitizeData, type QrData, type QrType } from '../quick-reply';
import { limit } from '../text';
import { dayStart, now } from '../time';
import type { MessageRow } from '../types';
import { insertMessage } from './messages';
import { sendPending } from './sender';

/** A message row a quick reply sends (js_message columns). */
type Out = Partial<Pick<MessageRow, 'm_msg_type' | 'm_content' | 'm_image' | 'm_buttons' | 'm_carousel'>>;

/**
 * An incoming customer message (text, or a tapped button / list item — its title) that
 * matches an active quick reply of the account: the reply is sent. Returns true when one was.
 * Runs after Chatbot Flows (an active flow answers first) and before the catalogue reply.
 */
export async function quickReplyIncoming(userId: number, mobile: string, name: string | null, content: string): Promise<boolean> {
  const text = String(content ?? '').trim();
  if (!mobile || !text || text.length > 4096) return false;
  const replies = await query<{ qr_id: number; qr_name: string; qr_keywords: string[]; qr_match: number; qr_type: QrType; qr_data: QrData }>(
    'SELECT qr_id, qr_name, qr_keywords, qr_match, qr_type, qr_data FROM js_quick_reply WHERE qr_user_id = $1 AND qr_status = 1', [userId]);
  if (!replies.length) return false;
  const hit = pickReply(replies.map((r) => ({ ...r, id: r.qr_id, keywords: r.qr_keywords ?? [], match: Number(r.qr_match) })), text);
  if (!hit) return false;

  const out = replyMessage(hit.qr_type, sanitizeData(hit.qr_type, hit.qr_data), { name: name || 'there', mobile });
  const t = now();
  const message = await insertMessage({
    ...out,
    m_mobile_no: mobile,
    m_contact_id: await contactId(userId, mobile),
    m_user_id: userId,
    m_is_incoming: 2,
    m_source: 2,
    m_sheet_id: 'Quick_Reply',
    m_title: limit(hit.qr_name, 250, ''),
    m_status: 6,
    m_in_process_on: t,
    m_created_date: dayStart(t),
    m_created_on: t,
  });
  await recordMessage(message);
  await exec('UPDATE js_quick_reply SET qr_hits = qr_hits + 1, qr_last_used = $2 WHERE qr_id = $1', [hit.qr_id, t]);
  // Sent log: when, to whom, which reply, what the customer wrote
  await exec(
    `INSERT INTO js_quick_reply_log (ql_user_id, ql_qr_id, ql_qr_name, ql_mobile, ql_name, ql_text, ql_keyword, ql_m_id, ql_sent_on)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [userId, hit.qr_id, limit(hit.qr_name, 250, ''), mobile, name ? limit(name, 250, '') : null, limit(text, 1000, ''),
      hit.keywords.find((k) => keywordMatches(text, k, hit.match)) ?? null, message.m_id, t]);
  await sendPending(message.m_id);
  return true;
}

/** The message a quick reply sends: text / media as a plain message, buttons and lists as WhatsApp interactive messages. */
export function replyMessage(type: QrType, d: QrData, vars: Record<string, string>): Out {
  const text = fillVars(d.text, vars);
  const footer = d.footer ? { footer: { text: limit(fillVars(d.footer, vars), 60, '') } } : {};
  if (type === 'text') return { m_msg_type: 'text', m_content: text };
  if (type === 'media') return { m_msg_type: 'text', m_content: text, m_image: encodeURI(d.media) };
  if (type === 'buttons') {
    const interactive: Record<string, unknown> = {
      type: 'button',
      body: { text: limit(text, 1024, '') || ' ' },
      action: { buttons: d.buttons.map((title, i) => ({ type: 'reply', reply: { id: `qr:${i}`, title: limit(title, 20, '') } })) },
      ...footer,
    };
    const media = d.media ? encodeURI(d.media) : '';
    if (media) {
      const kind = mediaKind(media);
      const filename = kind === 'document' ? fileNameOf(media) : '';
      interactive.header = { type: kind, [kind]: filename ? { link: media, filename } : { link: media } };
    }
    return { m_msg_type: 'bot', m_content: text, m_image: media || null, m_buttons: buttonList(d.buttons), m_carousel: JSON.stringify(interactive) };
  }
  const interactive = {
    type: 'list',
    body: { text: limit(text, 4096, '') || ' ' },
    action: {
      button: limit(d.listLabel || 'Options', 20, ''),
      sections: [{
        title: limit(d.listLabel || 'Options', 24, ''),
        rows: d.rows.map((r, i) => ({ id: `qr:${i}`, title: limit(r.title, 24, ''), ...(r.description ? { description: limit(fillVars(r.description, vars), 72, '') } : {}) })),
      }],
    },
    ...footer,
  };
  return { m_msg_type: 'bot', m_content: text, m_buttons: buttonList(d.rows.map((r) => r.title)), m_carousel: JSON.stringify(interactive) };
}

const buttonList = (titles: string[]) => titles.map((t) => t.replace(/,/g, ' ').trim()).join(',');

function mediaKind(url: string): 'image' | 'video' | 'document' {
  const ext = (/\.([a-z0-9]+)(?:[?#]|$)/i.exec(url)?.[1] ?? '').toLowerCase();
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'image';
  if (['mp4', '3gp'].includes(ext)) return 'video';
  return 'document';
}

function fileNameOf(url: string): string {
  const last = url.split(/[?#]/)[0].split('/').pop() ?? '';
  let name = last;
  try { name = decodeURIComponent(last); } catch { /* keep it encoded */ }
  return name.replace(/^\d{14}-/, '').slice(0, 240);
}
