import 'server-only';
import { crc32 } from 'node:zlib';
import { config } from '@/lib/config';
import { exec, like, one, query, value } from '@/lib/db';
import { contactDisplayName, contactInitials, contactWindowLeft, isErrorMessage, mediaInfo, messageStatusLabel, templateButtons, templateCards, type TemplateButton } from '@/lib/format';
import { templateParameters } from '@/lib/services/sender';
import { decodeEntities, jsonParse, limit, ucfirst } from '@/lib/text';
import { now, phpDate, shortTime, timestampToUnix } from '@/lib/time';
import type { ContactRow, MessageRow, TemplateRow } from '@/lib/types';
import { waToHtml } from '@/lib/whatsapp-text';
import type { Bubble, BubbleMedia, BubbleQuote, ConvRow, RenderedTemplate, TemplateButtonView, TemplateHeader, ThreadHeader, Tick } from './types';

/**
 * Data access for the WhatsApp inbox (port of User\ChatController's helpers):
 * js_user_contact_list is the conversation index (cl_last_* / cl_unread kept
 * current by recordMessage / refreshUnread), js_message holds the threads.
 */

export const LIST_PAGE = 30;
export const THREAD_PAGE = 40;

/** Columns a message bubble needs. */
export const BUBBLE_COLUMNS =
  'm_id, m_is_incoming, m_content, m_msg_type, m_msg_template_name, m_msg_template_para, m_image, m_carousel, m_created_on, ' +
  'm_delivery_status, m_status, m_message_id, m_status_response, m_is_read, m_context_id';

const CONV_COLUMNS = 'cl_mobile_no, cl_name, cl_last_msg, cl_last_msg_id, cl_last_preview, cl_last_dir, cl_last_in, cl_unread';

export type ConvSource = Pick<ContactRow, 'cl_mobile_no' | 'cl_name' | 'cl_last_msg' | 'cl_last_msg_id' | 'cl_last_preview' | 'cl_last_dir' | 'cl_last_in' | 'cl_unread'>;
export type BubbleSource = Pick<MessageRow, 'm_id' | 'm_is_incoming' | 'm_content' | 'm_msg_type' | 'm_msg_template_name' | 'm_msg_template_para' | 'm_image' | 'm_created_on' | 'm_delivery_status' | 'm_status' | 'm_message_id' | 'm_status_response' | 'm_is_read' | 'm_context_id'>
  & Partial<Pick<MessageRow, 'm_carousel'>>;

type TemplateSource = Pick<TemplateRow, 'ut_name' | 'ut_template_type' | 'ut_header_type' | 'ut_header' | 'ut_message' | 'ut_footer' | 'ut_buttons' | 'ut_cards'>;

/** Cross-site POSTs are refused (the Laravel route was CSRF-protected). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try {
    const host = new URL(origin).host;
    return host === req.headers.get('x-forwarded-host') || host === req.headers.get('host');
  } catch {
    return false;
  }
}

/** The `mb` request value: digits and + only. */
export function cleanMobile(v: string | null | undefined): string {
  return String(v ?? '').replace(/[^\d+]/g, '');
}

/**
 * Number variants of a conversation. Incoming numbers are stored without the
 * country code, but API/campaign messages may carry it, so match both.
 */
export function mobileVariants(mobile: string): string[] {
  const cc = config.countryCode;
  const plain = mobile.replace(/^\++/, '');
  const local = plain.startsWith(cc) && plain.length === cc.length + 10 ? plain.slice(cc.length) : plain;
  return [...new Set([mobile, local, cc + local, '+' + cc + local])];
}

export function hue(mobile: string): number {
  return crc32(String(mobile ?? '')) % 360;
}

// ------------------------------------------------------------------ conversations

export interface ConvFilter {
  filter: string;
  q: string;
}

/** WHERE clause for the conversation list (params[0] must be the user id). */
function conversationWhere(f: ConvFilter, params: unknown[]): string {
  let sql = 'cl_user_id = $1 AND cl_last_msg_id > 0';
  if (f.filter === 'unread') sql += ' AND cl_unread > 0';
  if (f.filter === 'active') {
    params.push(now() - 86400);
    sql += ` AND cl_last_in >= $${params.length}`;
  }
  const search = f.q.trim();
  if (search !== '') {
    params.push('%' + like(search) + '%');
    let cond = `cl_name ILIKE $${params.length}`;
    const digits = search.replace(/\D/g, '');
    if (digits !== '') {
      params.push('%' + digits + '%');
      cond += ` OR cl_mobile_no LIKE $${params.length}`;
    }
    sql += ` AND (${cond})`;
  }
  return sql;
}

/** One page of conversations, newest first; `before` is the last cl_last_msg_id already shown. */
export async function conversationPage(userId: number, f: ConvFilter, before: number | null): Promise<{ rows: ConvRow[]; before: number | null; more: boolean }> {
  const params: unknown[] = [userId];
  let where = conversationWhere(f, params);
  if (before !== null) {
    params.push(before);
    where += ` AND cl_last_msg_id < $${params.length}`;
  }
  params.push(LIST_PAGE + 1);
  const rows = await query<ConvSource>(
    `SELECT ${CONV_COLUMNS} FROM js_user_contact_list WHERE ${where} ORDER BY cl_last_msg_id DESC LIMIT $${params.length}`,
    params,
  );
  const page = rows.slice(0, LIST_PAGE);
  return { rows: page.map(convRow), before: page.length ? page[page.length - 1].cl_last_msg_id : null, more: rows.length > LIST_PAGE };
}

/** Conversations changed since `since` (unix seconds), newest change first. */
export async function changedConversations(userId: number, f: ConvFilter, since: number): Promise<ConvRow[]> {
  const params: unknown[] = [userId];
  const where = conversationWhere(f, params);
  params.push(since);
  const rows = await query<ConvSource>(
    `SELECT ${CONV_COLUMNS} FROM js_user_contact_list
      WHERE ${where} AND cl_updated_on >= to_timestamp($${params.length})::timestamp
      ORDER BY cl_updated_on DESC LIMIT 50`,
    params,
  );
  return rows.map(convRow);
}

/** The conversation row, or an unsaved one for a number that has no conversation yet. */
export async function contact(userId: number, mobile: string): Promise<ConvSource & { exists: boolean }> {
  const row = await one<ConvSource>(`SELECT ${CONV_COLUMNS} FROM js_user_contact_list WHERE cl_user_id = $1 AND cl_mobile_no = $2`, [userId, mobile]);
  return row
    ? { ...row, exists: true }
    : { cl_mobile_no: mobile, cl_name: null, cl_last_msg: null, cl_last_msg_id: 0, cl_last_preview: null, cl_last_dir: 0, cl_last_in: 0, cl_unread: 0, exists: false };
}

export async function unreadTotal(userId: number): Promise<number> {
  return (await value<number>('SELECT COALESCE(SUM(cl_unread), 0)::int FROM js_user_contact_list WHERE cl_user_id = $1 AND cl_unread > 0', [userId])) ?? 0;
}

/** Mark every unread incoming message of the conversation read. */
export async function markRead(userId: number, mobile: string): Promise<void> {
  await exec(
    `UPDATE js_message SET m_is_read = 1
      WHERE m_user_id = $1 AND m_mobile_no = ANY($2::text[]) AND m_is_incoming = 1 AND m_is_read = 2 AND m_dstatus = 0`,
    [userId, mobileVariants(mobile)],
  );
  // Skip the no-op update so the touch trigger doesn't bump cl_updated_on on every open
  await exec('UPDATE js_user_contact_list SET cl_unread = 0 WHERE cl_user_id = $1 AND cl_mobile_no = $2 AND cl_unread <> 0', [userId, mobile]);
}

export function convRow(c: ConvSource): ConvRow {
  const mobile = String(c.cl_mobile_no ?? '');
  return {
    mobile,
    last: Number(c.cl_last_msg_id) || 0,
    unread: Number(c.cl_unread) || 0,
    hue: hue(mobile),
    initials: contactInitials(c),
    name: contactDisplayName(c),
    time: shortTime(c.cl_last_msg ? timestampToUnix(c.cl_last_msg) : 0),
    preview: String(c.cl_last_preview ?? ''),
    outgoing: Number(c.cl_last_dir) === 2,
    live: contactWindowLeft(c) > 0,
  };
}

export function threadHeader(c: ConvSource): ThreadHeader {
  const mobile = String(c.cl_mobile_no ?? '');
  return { mobile, name: contactDisplayName(c), initials: contactInitials(c), hue: hue(mobile), showMobile: !!c.cl_name };
}

// ------------------------------------------------------------------ messages

/** Thread page, oldest first. Without `before` it is the newest page. */
export async function threadPage(userId: number, mobile: string, before: number | null): Promise<{ messages: BubbleSource[]; more: boolean }> {
  const params: unknown[] = [userId, mobileVariants(mobile)];
  let sql = `SELECT ${BUBBLE_COLUMNS} FROM js_message WHERE m_user_id = $1 AND m_mobile_no = ANY($2::text[]) AND m_dstatus = 0`;
  if (before !== null) {
    params.push(before);
    sql += ` AND m_id < $${params.length}`;
  }
  params.push(THREAD_PAGE + 1);
  const rows = await query<BubbleSource>(`${sql} ORDER BY m_id DESC LIMIT $${params.length}`, params);
  return { messages: rows.slice(0, THREAD_PAGE).reverse(), more: rows.length > THREAD_PAGE };
}

/** Messages newer than `after`, oldest first (max 100). */
export function newMessages(userId: number, mobile: string, after: number): Promise<BubbleSource[]> {
  return query<BubbleSource>(
    `SELECT ${BUBBLE_COLUMNS} FROM js_message
      WHERE m_user_id = $1 AND m_mobile_no = ANY($2::text[]) AND m_dstatus = 0 AND m_id > $3
      ORDER BY m_id LIMIT 100`,
    [userId, mobileVariants(mobile), after],
  );
}

/** Outgoing messages already shown whose delivery status changed since `since`. */
export function statusChanges(userId: number, mobile: string, after: number, since: number): Promise<BubbleSource[]> {
  return query<BubbleSource>(
    `SELECT ${BUBBLE_COLUMNS} FROM js_message
      WHERE m_user_id = $1 AND m_mobile_no = ANY($2::text[]) AND m_dstatus = 0 AND m_is_incoming = 2
        AND m_id <= $3 AND m_updated_on >= $4
      LIMIT 100`,
    [userId, mobileVariants(mobile), after, since],
  );
}

export function messageById(userId: number, id: number): Promise<BubbleSource | null> {
  return one<BubbleSource>(`SELECT ${BUBBLE_COLUMNS} FROM js_message WHERE m_id = $1 AND m_user_id = $2`, [id, userId]);
}

const FILE_ICONS: Record<string, string> = { document: 'ri-file-text-line' };
const MEDIA_TYPES = ['image', 'sticker', 'video', 'audio', 'document', 'location', 'reaction', 'contacts'];
const BUTTON_ICONS: Record<string, string> = { URL: 'ri-external-link-line', PHONE_NUMBER: 'ri-phone-line', COPY_CODE: 'ri-file-copy-line', FLOW: 'ri-survey-line' };
const IMAGE_RE = /\.(jpe?g|png|gif|webp)(\?|$)/i;
const VIDEO_RE = /\.(mp4|3gp|mov)(\?|$)/i;

/**
 * Latest template row per name for these messages (same pick as the sender:
 * ORDER BY ut_status, ut_id DESC), in one query per page of bubbles.
 */
async function templatesFor(userId: number, rows: BubbleSource[]): Promise<Map<string, TemplateSource>> {
  const names = [...new Set(rows.filter((m) => Number(m.m_is_incoming) === 2 && m.m_msg_template_name).map((m) => String(m.m_msg_template_name)))];
  if (!names.length) return new Map();
  const list = await query<TemplateSource>(
    `SELECT DISTINCT ON (ut_name) ut_name, ut_template_type, ut_header_type, ut_header, ut_message, ut_footer, ut_buttons, ut_cards
       FROM js_user_templates WHERE ut_user_id = $1 AND ut_name = ANY($2::text[])
      ORDER BY ut_name, ut_status, ut_id DESC`,
    [userId, names],
  );
  return new Map(list.map((t) => [t.ut_name, t]));
}

/** Bubbles for a batch of rows, with sent templates rendered as the customer saw them. */
export async function bubbles(userId: number, rows: BubbleSource[]): Promise<Bubble[]> {
  const [templates, quotes] = await Promise.all([templatesFor(userId, rows), quotesFor(userId, rows)]);
  return rows.map((m) => {
    const b = bubble(m, templates.get(String(m.m_msg_template_name ?? '')));
    const q = m.m_context_id ? quotes.get(m.m_context_id) : undefined;
    if (q) b.quote = Number(m.m_is_incoming) === 1 && (m.m_msg_type === 'button' || m.m_msg_type === 'interactive') && q.out
      ? { ...q, button: decodeEntities(m.m_content ?? '') }
      : q;
    return b;
  });
}

/** Plain-text preview of the messages these rows reply to, keyed by WhatsApp id (one query + their templates). */
async function quotesFor(userId: number, rows: BubbleSource[]): Promise<Map<string, BubbleQuote>> {
  const ids = [...new Set(rows.map((m) => m.m_context_id).filter((v): v is string => !!v))];
  if (!ids.length) return new Map();
  const quoted = await query<BubbleSource>(
    `SELECT DISTINCT ON (m_message_id) ${BUBBLE_COLUMNS} FROM js_message
      WHERE m_message_id = ANY($2::text[]) AND m_user_id = $1 AND m_dstatus = 0 ORDER BY m_message_id, m_id`,
    [userId, ids],
  );
  const templates = await templatesFor(userId, quoted);
  return new Map(quoted.map((m) => [String(m.m_message_id), { id: Number(m.m_id), out: Number(m.m_is_incoming) === 2, text: quoteText(m, templates.get(String(m.m_msg_template_name ?? ''))) }]));
}

const QUOTE_LABELS: Record<string, string> = {
  image: '📷 Photo', sticker: 'Sticker', video: '🎥 Video', audio: '🎤 Audio', document: '📄 Document', location: '📍 Location', contacts: '👤 Contact',
};

/** One-line preview: the template body as the customer saw it, the text / caption, or the media kind. */
function quoteText(m: BubbleSource, tpl?: TemplateSource): string {
  let text = decodeEntities(m.m_content ?? '');
  if (text === 'File_Attachment') text = String(mediaInfo(m).caption ?? '');
  if (text === '' && m.m_msg_template_name) {
    text = tpl ? fillParams(decodeEntities(tpl.ut_message ?? ''), templateParameters(m.m_msg_template_para)) : String(m.m_msg_template_name);
  }
  if (text === '') text = QUOTE_LABELS[String(m.m_msg_type ?? '')] ?? 'Message';
  // Plain text like WhatsApp's quote: formatting markers dropped
  return limit(text.replace(/```/g, '').replace(/(^|\s)[*_~]+(?=\S)|(?<=\S)[*_~]+(?=$|[\s.,!?:;)])/g, '$1').replace(/\s+/g, ' ').trim(), 220);
}

/** Replace {{n}} with the n-th parameter; unknown placeholders are left as they are. */
function fillParams(text: string, params: string[]): string {
  return text.replace(/\{\{\s*(\d+)\s*\}\}/g, (all, n) => params[Number(n) - 1] ?? all);
}

function buttonViews(list: TemplateButton[]): TemplateButtonView[] {
  return list.map((b) => ({ icon: BUTTON_ICONS[String(b.type ?? '')] ?? 'ri-reply-line', text: String(b.text ?? '') })).filter((b) => b.text !== '');
}

function mediaHeader(kind: string, url: string): TemplateHeader | null {
  if (!url.startsWith('http')) return null;
  const k = kind === 'VIDEO' || VIDEO_RE.test(url) ? 'video' : kind === 'IMAGE' || IMAGE_RE.test(url) ? 'image' : 'document';
  return { kind: k, url, name: basename(url) };
}

function renderTemplate(m: BubbleSource, t: TemplateSource, files: string[]): RenderedTemplate {
  const params = templateParameters(m.m_msg_template_para);
  const headerType = String(t.ut_header_type ?? '').toUpperCase();
  let header: TemplateHeader | null = null;
  if (headerType === 'TEXT' || (headerType === '' && t.ut_header)) {
    const text = decodeEntities(t.ut_header ?? '').trim();
    if (text) header = { kind: 'text', text };
  } else if (headerType) {
    // The media actually sent (m_image), else the sample media on the template
    header = mediaHeader(headerType, files[0] ?? '') ?? mediaHeader(headerType, decodeEntities(t.ut_header ?? ''));
  }

  const values = jsonParse<any[]>(m.m_carousel ?? '', []);
  const cards = t.ut_template_type === 'carousel'
    ? templateCards(t).map((card, i) => {
      const v = (Array.isArray(values) ? values[i] : null) ?? {};
      const cardParams: string[] = (Array.isArray(v.params) ? v.params : Object.values(v.params ?? {})).map((p: unknown) => String(p ?? ''));
      return {
        header: mediaHeader(String(card.header_type ?? 'IMAGE').toUpperCase(), String(v.media || card.header || '')),
        html: waToHtml(fillParams(decodeEntities(card.body ?? ''), cardParams)),
        buttons: buttonViews(card.buttons ?? []),
      };
    })
    : [];

  return {
    header,
    html: waToHtml(fillParams(decodeEntities(t.ut_message ?? ''), params)),
    footer: decodeEntities(t.ut_footer ?? ''),
    buttons: buttonViews(templateButtons(t)),
    cards,
  };
}

function basename(u: string): string {
  let p = u;
  try {
    p = new URL(u).pathname;
  } catch {
    p = u.split(/[?#]/)[0];
  }
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

/**
 * Shared contact cards: the payload is a JSON array, which lib/format
 * mediaInfo() drops (it only keeps objects), so decode it here the same way.
 */
function contactCards(m: BubbleSource): any[] {
  if (Number(m.m_is_incoming) !== 1) return [];
  let raw = decodeEntities(m.m_image ?? '');
  if (!raw.includes('\\')) raw = raw.replace(/u(d[89ab][0-9a-f]{2})u(d[c-f][0-9a-f]{2})/gi, '\\u$1\\u$2');
  const v = jsonParse<unknown>(raw, null);
  return Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : [];
}

/** Display data for one bubble (_bubble.blade.php); pass the template row to render a sent template. */
export function bubble(m: BubbleSource, tpl?: TemplateSource): Bubble {
  const out = Number(m.m_is_incoming) === 2;
  const type = String(m.m_msg_type ?? '');
  const info = mediaInfo(m);
  let text = decodeEntities(m.m_content ?? '');
  if (text === 'File_Attachment') text = String(info.caption ?? '');
  const view = `/view_attachment/${m.m_id}`;
  const urls = out ? String(m.m_image ?? '').split(',').map((u) => u.trim()).filter((u) => u.startsWith('http')) : [];
  const rendered = out && tpl && m.m_msg_template_name && text === '' ? renderTemplate(m, tpl, urls) : null;
  // A media template's first file is its header, already shown by `rendered`
  const headerUsed = rendered?.header && rendered.header.kind !== 'text' && urls[0] === rendered.header.url ? 1 : 0;
  const files = urls.slice(headerUsed).map((u) => ({ url: u, image: IMAGE_RE.test(u), name: basename(u) }));
  const isError = out && isErrorMessage(m);
  const status = out ? messageStatusLabel(m) : '';

  let media: BubbleMedia | null = null;
  if (!out && (type === 'image' || type === 'sticker')) {
    media = { kind: 'image', type, href: view };
  } else if (!out && (type === 'video' || type === 'audio')) {
    media = { kind: type, href: view, name: String(info.filename ?? ucfirst(type)) };
  } else if (!out && FILE_ICONS[type]) {
    media = { kind: 'file', icon: FILE_ICONS[type], name: String(info.filename ?? ucfirst(type)), href: view };
  } else if (type === 'location' && info.latitude != null) {
    media = { kind: 'location', name: String(info.name ?? info.address ?? 'Shared location'), href: `https://maps.google.com/?q=${info.latitude},${info.longitude}` };
  } else if (type === 'reaction') {
    media = { kind: 'reaction', emoji: String(info.emoji ?? '') };
  } else if (type === 'contacts') {
    const names = contactCards(m).map((c: any) => c?.name?.formatted_name).filter(Boolean).join(', ');
    media = { kind: 'contacts', names: names || 'Contact card' };
  }

  let template: Bubble['template'] = null;
  let html: string | null = null;
  let placeholder: string | null = null;
  if (out && m.m_msg_template_name && text === '') {
    if (!rendered) template = { name: m.m_msg_template_name, para: m.m_msg_template_para ? decodeEntities(m.m_msg_template_para) : '' };
  } else if (text !== '' && type !== 'reaction') {
    html = waToHtml(text);
  } else if (text === '' && !files.length && !MEDIA_TYPES.includes(type)) {
    placeholder = ucfirst(type || 'message');
  }

  let tick: Tick | null = null;
  if (out) {
    if (isError) tick = 'error';
    else if (m.m_delivery_status === 'read') tick = 'read';
    else if (m.m_delivery_status === 'delivered') tick = 'delivered';
    else if (m.m_delivery_status === 'sent' || (Number(m.m_status) === 3 && m.m_message_id)) tick = 'sent';
    else if (m.m_delivery_status === 'failed') tick = 'failed';
    else tick = 'pending';
  }

  return {
    id: Number(m.m_id),
    out,
    day: phpDate('Y-m-d', Number(m.m_created_on)),
    time: phpDate('H:i', Number(m.m_created_on)),
    failed: isError,
    status,
    tick,
    media,
    files,
    template,
    rendered,
    html,
    placeholder,
    quote: null,
  };
}
