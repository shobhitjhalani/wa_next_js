import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config';
import { exec, one, query, value } from '../db';
import { internationalise } from '../phone';
import { decodeEntities, jsonParse, limit } from '../text';
import { phpDate, withinHours } from '../time';
import { templateButtons, templateCards } from '../format';
import type { MessageRow, UserRow } from '../types';
import { sendMarketingMessage, sendMessage, type MetaResponse } from './meta';
import { safeFileName, storeBytes } from './media';
import { isLimitedType, LIMIT_REACHED, releaseTemplateSend, reserveTemplateSend } from './template-limit';
import { allowedCategories, CATEGORY_NOT_ALLOWED } from '../template-categories';

/**
 * Sends queued messages through the Cloud API and records the outcome.
 * Port of Common::fun_send_whatsapp_meta / Laravel MessageSender.
 *
 * js_message.m_status: 1 In queue · 6 Processing · 3 Sent (m_message_id
 * empty = API error) · 9 Opt-out.
 *
 * Faster than the PHP version: rows are claimed in one statement
 * (FOR UPDATE SKIP LOCKED, so overlapping runs never double-send), user and
 * template lookups are cached per run, and Meta calls run with bounded
 * concurrency (WA_SEND_CONCURRENCY).
 */

const IMAGE = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
const VIDEO = ['mpg', 'mp2', 'mpeg', 'mpe', 'mpv', 'mp4', 'm4p', 'm4v', '3gp'];

type SendUser = Pick<UserRow, 'u_id' | 'u_code' | 'u_wa_phone_id' | 'u_wa_b_id' | 'u_template_categories'>;
type Media = { type: string; link: string; name?: string };
type Payload = Record<string, any>;

/** Per-run lookup cache so a batch of 100 messages doesn't repeat the same queries. */
class RunCache {
  users = new Map<number, Promise<SendUser | null>>();
  blocked = new Map<number, Promise<Set<string>>>();
  templates = new Map<string, Promise<{ ut_language: string | null; ut_cards: string | null; ut_buttons: string | null; ut_template_category: string | null } | null>>();

  user(id: number) {
    if (!this.users.has(id)) this.users.set(id, one<SendUser>('SELECT u_id, u_code, u_wa_phone_id, u_wa_b_id, u_template_categories FROM js_user WHERE u_id = $1', [id]));
    return this.users.get(id)!;
  }

  blockList(userId: number) {
    if (!this.blocked.has(userId)) {
      this.blocked.set(userId, query<{ ubl_mobile_no: string }>('SELECT ubl_mobile_no FROM js_user_block_list WHERE ubl_user_id = $1 AND ubl_dstatus = 0', [userId])
        .then((rows) => new Set(rows.map((r) => String(r.ubl_mobile_no)))));
    }
    return this.blocked.get(userId)!;
  }

  template(userId: number, name: string) {
    const key = `${userId}:${name}`;
    if (!this.templates.has(key)) {
      this.templates.set(key, one('SELECT ut_language, ut_cards, ut_buttons, ut_template_category FROM js_user_templates WHERE ut_user_id = $1 AND ut_name = $2 ORDER BY ut_status, ut_id DESC LIMIT 1', [userId, name]));
    }
    return this.templates.get(key)!;
  }
}

/** Run fn over items with at most `limit` in flight. */
export async function mapLimit<T, R>(items: T[], max: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(max, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Unix time before which an outgoing message has expired and must never be sent (WA_MSG_EXPIRY). */
export function expiryCutoff(): number {
  return Math.floor(Date.now() / 1000) - config.messageExpiry;
}

const PENDING_SQL = `
  SELECT m.* FROM js_message m JOIN js_user u ON u.u_id = m.m_user_id
   WHERE m.m_is_incoming = 2 AND m.m_status = 6 AND m.m_dstatus = 0 AND m.m_created_on >= $1
     AND u.u_wa_plan_status = 1 AND u.u_status = 1 AND u.u_dstatus = 0`;

/**
 * Send messages already marked "processing" (status 6). Pass a message id to
 * send just that one (API / chat / webhook replies). Returns how many were processed.
 * Messages older than WA_MSG_EXPIRY are never sent (expire-messages cancels them).
 */
export async function sendPending(messageId?: number, userId?: number): Promise<number> {
  const params: unknown[] = [expiryCutoff()];
  let sql = PENDING_SQL;
  if (messageId) { params.push(messageId); sql += ` AND m.m_id = $${params.length}`; }
  if (userId) { params.push(userId); sql += ` AND m.m_user_id = $${params.length}`; }
  sql += ' ORDER BY m.m_id';
  const rows = await query<MessageRow>(sql, params);
  return sendRows(rows);
}

/**
 * Campaign / template messages may only go out between WA_SEND_START_HOUR
 * and WA_SEND_END_HOUR (07:00–23:00) in the app time zone. Replies inside the
 * 24-hour window, OTP / API and bot messages are not campaign messages.
 */
export function inSendWindow(at: Date = new Date()): boolean {
  return withinHours(at, config.sendStartHour, config.sendEndHour, config.timezone);
}

/** "07:00 and 23:00" — the sending window for messages shown to users. */
export function sendWindowLabel(): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(config.sendStartHour)}:00 and ${pad(config.sendEndHour)}:00`;
}

/** Move a message to "processing" and send it straight away (report re-send). */
export async function sendNow(messageId: number): Promise<boolean> {
  const claimed = await exec(
    'UPDATE js_message SET m_status = 6, m_in_process_on = $2 WHERE m_id = $1 AND m_created_on >= $3',
    [messageId, Math.floor(Date.now() / 1000), expiryCutoff()],
  );
  if (!claimed) return false; // expired — never re-sent
  return (await sendPending(messageId)) > 0;
}

/**
 * Atomically claim up to `batch` queued messages of a user (status 1 → 6)
 * created since `since`, and send them. Used by the queue worker.
 */
export async function claimAndSend(userId: number, since: number, batch: number): Promise<number> {
  const rows = await query<MessageRow>(
    `UPDATE js_message SET m_status = 6, m_in_process_on = $3
      WHERE m_id IN (
        SELECT m_id FROM js_message
         WHERE m_user_id = $1 AND m_is_incoming = 2 AND m_status = 1 AND m_dstatus = 0 AND m_created_on >= $2
         ORDER BY m_id LIMIT $4 FOR UPDATE SKIP LOCKED)
      RETURNING *`,
    [userId, Math.max(since, expiryCutoff()), Math.floor(Date.now() / 1000), batch],
  );
  rows.sort((a, b) => a.m_id - b.m_id);
  return sendRows(rows);
}

/**
 * Recipients are sent to in parallel; messages to the same recipient stay
 * sequential and in id order, so a conversation never arrives out of order.
 */
async function sendRows(rows: MessageRow[]): Promise<number> {
  if (!rows.length) return 0;
  const cache = new RunCache();
  const byRecipient = new Map<string, MessageRow[]>();
  for (const m of rows) {
    const key = `${m.m_user_id}:${m.m_mobile_no}`;
    if (!byRecipient.has(key)) byRecipient.set(key, []);
    byRecipient.get(key)!.push(m);
  }
  let sent = 0;
  await mapLimit([...byRecipient.values()], config.sendConcurrency, async (list) => {
    for (const m of list) {
      try {
        if (await send(m, cache)) sent++;
      } catch (e) {
        console.error('[sender] message', m.m_id, e);
      }
    }
  });
  return sent;
}

async function send(message: MessageRow, cache: RunCache): Promise<boolean> {
  const user = await cache.user(message.m_user_id);
  if (!user) return false;
  const mobile = String(message.m_mobile_no ?? '').replace(/\s+/g, '');
  if (mobile === '') return false;
  const t = Math.floor(Date.now() / 1000);

  if ((await cache.blockList(user.u_id)).has(mobile)) {
    await exec("UPDATE js_message SET m_status = 9, m_in_process_on = $2, m_updated_on = $2, m_status_response = 'Opt Out' WHERE m_id = $1", [message.m_id, t]);
    return true;
  }

  const to = internationalise(mobile);
  const media = await collectMedia(message, user);

  // Template messages count against the account's limit; a reserved slot is given back if WhatsApp rejects the send
  const limited = isLimitedType(message.m_msg_type);
  const refuse = async (reason: string) => {
    await exec(
      'UPDATE js_message SET m_status = 3, m_in_process_on = $2, m_updated_on = $2, m_message_id = $3, m_msg_id_count = 0, m_status_response = $4 WHERE m_id = $1',
      [message.m_id, t, '', JSON.stringify([{ error: { message: reason, code: null } }])],
    );
    return true;
  };
  // Accounts restricted to some template categories (e.g. utility only) never send the others
  if (limited && !(await categoryPermitted(user, message, cache))) return refuse(CATEGORY_NOT_ALLOWED);
  if (limited && !(await reserveTemplateSend(user.u_id))) return refuse(LIMIT_REACHED);

  let responses: MetaResponse[];
  try {
    switch (message.m_msg_type) {
      case 'template': responses = [await sendTemplate(user, message, to, media, cache)]; break;
      case 'flow': responses = [await sendFlow(user, message, to, media, cache)]; break;
      case 'carousel': responses = [await sendCarousel(user, message, to, cache)]; break;
      case 'Authentication': responses = [await sendAuthentication(user, message, to, cache)]; break;
      case 'catalogue':
      case 'product_list': responses = [await sendProductList(user, message, to)]; break;
      default: responses = await sendText(user, message, to, media);
    }
  } catch (e) {
    if (limited) await releaseTemplateSend(user.u_id);
    throw e;
  }

  const ids: string[] = [];
  let error: MetaResponse['error'] | null = null;
  for (const res of responses) {
    for (const m of res.messages ?? []) ids.push(m.id);
    error ??= res.error ?? null;
  }

  const done = Math.floor(Date.now() / 1000);
  const waIds = ids.join(',');
  const statusResponse = ids.length
    ? undefined
    : limit(JSON.stringify([{ error: { message: error?.message ?? 'Unable to send', code: error?.code ?? null } }]), 250, '');

  await exec(
    `UPDATE js_message SET m_status = 3, m_in_process_on = $2, m_updated_on = $2, m_message_id = $3, m_msg_id_count = $4,
            m_response_file_name = $5, m_delivery_status = $6, m_status_response = COALESCE($7, m_status_response)
      WHERE m_id = $1`,
    [message.m_id, done, waIds, ids.length, limit(media.map((x) => x.link).join(','), 250, ''), ids.length ? 'sent' : null, statusResponse ?? null],
  );
  if (ids.length) await exec('UPDATE js_user SET u_last_wa_send = $2 WHERE u_id = $1', [user.u_id, done]);
  else if (limited) await releaseTemplateSend(user.u_id);
  await exec(
    `INSERT INTO js_message_log (ml_m_id, ml_wa_id, ml_count, ml_user_id)
     VALUES ($1, $2, (SELECT COUNT(*) FROM js_message_log WHERE ml_m_id = $1), $3)`,
    [message.m_id, waIds, user.u_id],
  );
  return true;
}

// ---------------------------------------------------------------- message types

async function sendTemplate(user: SendUser, m: MessageRow, to: string, media: Media[], cache: RunCache) {
  const components = templateComponents(m, media);
  const buttons = Object.entries(templateValues(m.m_msg_template_para).buttons);
  if (buttons.length) {
    for (const [index, text] of buttons) components.push({ type: 'button', sub_type: 'url', index, parameters: [{ type: 'text', text }] });
  } else if (m.m_button_url) components.push(urlButtonComponent(m.m_button_url));
  const payload = await templatePayload(user, m, to, components, cache);
  return Number(m.m_msg_lite) === 1 ? sendMarketingMessage(user, payload) : sendMessage(user, payload);
}

async function sendFlow(user: SendUser, m: MessageRow, to: string, media: Media[], cache: RunCache) {
  const components = templateComponents(m, media);
  // The Flow button can sit after other buttons (e.g. a quick reply first)
  const template = await cache.template(user.u_id, String(m.m_msg_template_name ?? ''));
  const index = template ? templateButtons(template).findIndex((b) => b.type === 'FLOW') : -1;
  components.push({ type: 'button', sub_type: 'flow', index: String(Math.max(index, 0)) });
  return sendMessage(user, await templatePayload(user, m, to, components, cache));
}

/**
 * Media card carousel: bubble body parameters, then per card the header
 * media, card body parameters and button parameters (m_carousel).
 */
async function sendCarousel(user: SendUser, m: MessageRow, to: string, cache: RunCache): Promise<MetaResponse> {
  const template = await cache.template(user.u_id, String(m.m_msg_template_name ?? ''));
  const cards = template ? templateCards(template) : [];
  const values = jsonParse<any[]>(m.m_carousel, []);
  if (!template || !cards.length || !values.length) return { error: { message: 'Carousel template or card data missing' } };

  const out = cards.map((card, i) => {
    const v = values[i] ?? {};
    const mediaType = card.header_type === 'VIDEO' ? 'video' : 'image';
    const components: Payload[] = [{ type: 'header', parameters: [{ type: mediaType, [mediaType]: { link: v.media ?? '' } }] }];
    const params: unknown[] = Array.isArray(v.params) ? v.params : Object.values(v.params ?? {});
    if (params.length) components.push({ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p ?? '') })) });
    (card.buttons ?? []).forEach((button, b) => {
      const type = button.type ?? '';
      if (type === 'QUICK_REPLY') {
        components.push({ type: 'button', sub_type: 'quick_reply', index: String(b), parameters: [{ type: 'payload', payload: limit(String(button.text ?? 'card' + i), 128, '') }] });
      } else if (type === 'URL' && v.url_params?.[b] != null) {
        components.push({ type: 'button', sub_type: 'url', index: String(b), parameters: [{ type: 'text', text: String(v.url_params[b]) }] });
      }
    });
    return { card_index: i, components };
  });

  const components: Payload[] = [];
  const params = templateParameters(m.m_msg_template_para);
  if (params.length) components.push({ type: 'body', parameters: params.map((v) => ({ type: 'text', text: v })) });
  components.push({ type: 'carousel', cards: out });
  const payload = await templatePayload(user, m, to, components, cache);
  return Number(m.m_msg_lite) === 1 ? sendMarketingMessage(user, payload) : sendMessage(user, payload);
}

/** OTP templates: body carries the code and the copy-code button repeats it. */
async function sendAuthentication(user: SendUser, m: MessageRow, to: string, cache: RunCache) {
  const params = templateParameters(m.m_msg_template_para);
  const components: Payload[] = [];
  if (params.length) components.push({ type: 'body', parameters: params.map((v) => ({ type: 'text', text: v })) });
  components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: String(params[params.length - 1] ?? '') }] });
  return sendMessage(user, await templatePayload(user, m, to, components, cache));
}

/** Interactive product list built from js_user_catalogue rows matching the message title. */
async function sendProductList(user: SendUser, m: MessageRow, to: string): Promise<MetaResponse> {
  const keywords = [m.m_title, 'Universal'].filter((k): k is string => !!k);
  const items = await query<{ c_catalogue_id: string; c_item_id: string; c_model: string | null }>(
    'SELECT c_catalogue_id, c_item_id, c_model FROM js_user_catalogue WHERE c_user_id = $1 AND c_keyword = ANY($2::citext[]) ORDER BY c_id',
    [user.u_id, keywords],
  );
  if (!items.length) return { error: { message: 'No catalogue items for ' + (m.m_title ?? '') } };
  return sendMessage(user, {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'product_list',
      header: { type: 'text', text: limit(m.m_title ?? '', 60, '') },
      body: { text: decodeEntities(m.m_content) || 'Please explore our catalogue.' },
      action: {
        catalog_id: items[0].c_catalogue_id,
        sections: [{
          title: limit(items[0].c_model || m.m_title || '', 24, ''),
          product_items: items.map((i) => ({ product_retailer_id: i.c_item_id })),
        }],
      },
    },
  });
}

/**
 * Session (non-template) messages: plain text, one captioned media, text +
 * several media, or interactive reply buttons / list.
 */
async function sendText(user: SendUser, m: MessageRow, to: string, media: Media[]): Promise<MetaResponse[]> {
  const text = decodeEntities(m.m_content);
  const buttons = String(m.m_buttons ?? '').split(',').map((b) => b.trim()).filter(Boolean);
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to };

  if (!buttons.length && !media.length) {
    return [await sendMessage(user, { ...base, type: 'text', text: { preview_url: false, body: text } })];
  }
  if (!buttons.length && media.length === 1) {
    return [await sendMessage(user, { ...base, ...mediaPayload(media[0], text) })];
  }

  const responses: MetaResponse[] = [];
  if (buttons.length) {
    const interactive: Payload = { body: { text: text !== '' ? text : ' ' } };
    let headerSent = false;
    if (buttons.length <= 3) {
      interactive.type = 'button';
      if (media.length) {
        const first = media[0];
        interactive.header = { type: first.type, [first.type]: first.name ? { link: first.link, filename: first.name } : { link: first.link } };
        headerSent = true;
      }
      interactive.action = { buttons: buttons.map((title, i) => ({ type: 'reply', reply: { id: 'btn' + (i + 1), title: limit(title, 20, '') } })) };
    } else {
      interactive.type = 'list';
      interactive.action = {
        button: 'Choose One',
        sections: [{ title: 'Menu', rows: buttons.map((t, i) => ({ id: 'btn' + (i + 1), title: limit(t, 24, '') })) }],
      };
    }
    responses.push(await sendMessage(user, { ...base, type: 'interactive', interactive }));
    for (let i = 0; i < media.length; i++) {
      if (i === 0 && headerSent) continue;
      responses.push(await sendMessage(user, { ...base, ...mediaPayload(media[i]) }));
    }
    return responses;
  }

  // Text followed by each attachment
  responses.push(await sendMessage(user, { ...base, type: 'text', text: { preview_url: false, body: text } }));
  for (const file of media) responses.push(await sendMessage(user, { ...base, ...mediaPayload(file) }));
  return responses;
}

// ---------------------------------------------------------------- helpers

/**
 * The template's category (as last synced from WhatsApp) is one the account may
 * send. Authentication messages are the AUTHENTICATION category; a template we
 * don't know is refused for restricted accounts.
 */
async function categoryPermitted(user: SendUser, m: MessageRow, cache: RunCache): Promise<boolean> {
  const allowed = allowedCategories(user.u_template_categories);
  if (!allowed) return true;
  const tpl = await cache.template(user.u_id, String(m.m_msg_template_name ?? ''));
  const category = m.m_msg_type === 'Authentication' ? 'AUTHENTICATION' : String(tpl?.ut_template_category ?? '').toUpperCase();
  return (allowed as string[]).includes(category);
}

async function templatePayload(user: SendUser, m: MessageRow, to: string, components: Payload[], cache: RunCache): Promise<Payload> {
  const name = String(m.m_msg_template_name ?? '');
  const tpl = await cache.template(user.u_id, name);
  const payload: Payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: { name, language: { code: tpl?.ut_language || 'en' } },
  };
  if (components.length) payload.template.components = components;
  return payload;
}

/** Header (media) + body parameter components shared by template and flow sends. */
function templateComponents(m: MessageRow, media: Media[]): Payload[] {
  const components: Payload[] = [];
  if (media.length) {
    components.push({
      type: 'header',
      parameters: media.map((x) => {
        const body: Payload = { link: x.link };
        if (x.type === 'document' && x.name) body.filename = x.name;
        return { type: x.type, [x.type]: body };
      }),
    });
  }
  const values = templateValues(m.m_msg_template_para);
  if (!media.length && values.header !== null) components.push({ type: 'header', parameters: [{ type: 'text', text: values.header }] });
  if (values.body.length) components.push({ type: 'body', parameters: values.body.map((v) => ({ type: 'text', text: v })) });
  return components;
}

/** Dynamic URL button: Meta expects only the suffix, here the encoded query string. */
function urlButtonComponent(buttonUrl: string): Payload {
  let qs = '';
  try {
    const u = new URL(buttonUrl, 'http://x');
    qs = new URLSearchParams(u.search).toString();
  } catch { /* keep empty */ }
  return { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '?' + qs }] };
}

/**
 * Parameters are comma separated. Some legacy clients sent "|" separated
 * values (so commas could appear inside a value) — honour that too.
 */
export function templateParameters(raw: string | null | undefined): string[] {
  return templateValues(raw).body;
}

/** Values a template message is sent with: body {{n}}, text-header {{1}}, dynamic URL button suffixes by button index. */
export interface TemplateValues {
  body: string[];
  header: string | null;
  buttons: Record<string, string>;
}

/**
 * m_msg_template_para holds either the legacy list ("a,b" or "a|b") or, for
 * API messages, JSON {"body":[…],"header":"…","buttons":{"0":"…"}} so values
 * may contain commas and URL buttons / text headers can be filled.
 */
export function templateValues(raw: string | null | undefined): TemplateValues {
  const v = String(raw ?? '');
  if (v.startsWith('{')) {
    const j = jsonParse<any>(v, null);
    if (j && typeof j === 'object' && Array.isArray(j.body)) {
      const buttons: Record<string, string> = {};
      for (const [k, b] of Object.entries(j.buttons ?? {})) if (/^\d+$/.test(k) && b != null) buttons[k] = String(b);
      return { body: j.body.map((p: unknown) => String(p ?? '')), header: j.header == null ? null : String(j.header), buttons };
    }
  }
  const d = decodeEntities(v);
  if (d === '') return { body: [], header: null, buttons: {} };
  return { body: d.split(d.includes('|') ? '|' : ',').map((p) => p.trim()), header: null, buttons: {} };
}

function mediaPayload(file: Media, caption = ''): Payload {
  const body: Payload = { link: file.link };
  if (caption !== '' && file.type !== 'audio') body.caption = caption;
  if (file.type === 'document' && file.name) body.filename = file.name;
  return { type: file.type, [file.type]: body };
}

function mediaType(filename: string): string {
  const ext = (/\.([^.]+)$/.exec(filename)?.[1] ?? '').toLowerCase();
  if (IMAGE.includes(ext)) return 'image';
  if (VIDEO.includes(ext)) return 'video';
  return 'document';
}

/**
 * Attachments come either as public URLs in m_image (comma separated) or as
 * a base64 JSON payload saved by the API (m_base_file), which is written to
 * the public media folder so Meta can fetch it.
 */
async function collectMedia(m: MessageRow, user: SendUser): Promise<Media[]> {
  const files: Media[] = [];
  for (const raw of String(m.m_image ?? '').split(',')) {
    const link = raw.trim();
    if (!link.startsWith('http')) continue; // incoming media metadata (JSON) is never re-sent
    let name = '';
    try { name = path.basename(new URL(link).pathname); } catch { name = path.basename(link); }
    files.push({ type: link.includes('youtube') ? 'video' : mediaType(name), link, name });
  }
  if (files.length || !m.m_base_file) return files;

  let items: { body?: string; name?: string; extension?: string }[] = [];
  try {
    items = jsonParse(await readFile(path.join(config.apiMediaPath, path.basename(m.m_base_file)), 'utf8'), []);
  } catch {
    return [];
  }
  const folder = `wa_msg/${phpDate('ymd')}/${user.u_code || user.u_id}`;
  for (const item of Array.isArray(items) ? items : []) {
    if (!item?.body) continue;
    let name = safeFileName(String(item.name ?? 'file')).replace(/[^A-Za-z0-9._-]/g, '_');
    if (!name.includes('.')) name += '.' + (item.extension ?? 'pdf');
    const link = await storeBytes(Buffer.from(item.body, 'base64'), folder, name);
    files.push({ type: mediaType(name), link, name });
  }
  return files;
}

/** Number of messages waiting in "processing" (diagnostics). */
export function processingCount(): Promise<number | null> {
  return value<number>('SELECT COUNT(*) FROM js_message WHERE m_status = 6 AND m_is_incoming = 2 AND m_dstatus = 0');
}
