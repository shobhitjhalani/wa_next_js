import 'server-only';
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { exec, insert, pool, query, type Queryable } from '../db';
import { fileExt } from '../actions';
import { templateCards } from '../format';
import { blockNumber, contactId, recordMessage } from '../models';
import { limit } from '../text';
import { dayStart, now, phpDate } from '../time';
import type { MessageRow, TemplateRow, UserRow } from '../types';
import { storePublic } from './media';

/**
 * Creates js_message rows: campaigns, chat replies, API requests and
 * incoming webhook messages. Port of Frontend::fun_send_template,
 * save_msg.php, CrmApi::fun_create_whatsapp(_api) and fun_incoming_msg.
 */

/** An error whose message is meant for the user (Laravel InvalidArgumentException). */
export class UserError extends Error {}

/** Upload extensions accepted for template header media. */
export const HEADER_UPLOADS = ['jpg', 'jpeg', 'png', 'pdf', 'mp4'];

export async function insertMessage(row: Partial<MessageRow>, db: Queryable = pool): Promise<MessageRow> {
  return insert<MessageRow>('js_message', row as Record<string, unknown>, '*', db);
}

export interface CardInput {
  params?: string[];
  url_params?: Record<string, string> | string[];
}

/**
 * The template values every message of a campaign carries: [message type,
 * js_message fields]. Header media is stored now, so a scheduled campaign
 * keeps it until it goes out.
 */
export async function templateFields(
  template: Pick<TemplateRow, 'ut_template_type' | 'ut_cards'>,
  parameters: string[],
  headerFiles: File[],
  cards: CardInput[] = [],
  cardFiles: (File | null)[] = [],
): Promise<[string, Record<string, unknown>]> {
  const fields: Record<string, unknown> = { m_msg_template_para: limit(parameters.join(','), 250, '') };

  if (template.ut_template_type === 'carousel') {
    const carousel = [];
    const list = templateCards(template);
    for (let i = 0; i < list.length; i++) {
      const file = cardFiles[i];
      if (!file) throw new UserError(`Please upload media for card ${i + 1}.`);
      const allowed = list[i].header_type === 'VIDEO' ? ['mp4'] : ['jpg', 'jpeg', 'png'];
      if (!allowed.includes(fileExt(file))) throw new UserError(`Card ${i + 1}: invalid file extension. Allowed: ${allowed.join(', ')}`);
      carousel.push({
        media: await storePublic(file, 'watemplate'),
        params: Object.values(cards[i]?.params ?? []),
        url_params: cards[i]?.url_params ?? [],
      });
    }
    return ['carousel', { ...fields, m_carousel: JSON.stringify(carousel) }];
  }

  const urls: string[] = [];
  for (const file of headerFiles) {
    if (!HEADER_UPLOADS.includes(fileExt(file))) throw new UserError(`Invalid file extension. Allowed: ${HEADER_UPLOADS.join(', ')}`);
    urls.push(await storePublic(file, 'watemplate'));
  }
  const type = ['template', 'flow', 'Authentication'].includes(template.ut_template_type) ? template.ut_template_type : 'template';
  return [type, { ...fields, m_image: urls.join(',') }];
}

/**
 * Queue one message per number for a campaign in a single INSERT … SELECT
 * over an array (thousands of rows per round trip). Returns the count.
 */
export async function queueMessages(
  userId: number,
  campaignId: number,
  templateName: string,
  numbers: string[],
  type: string,
  fields: Record<string, unknown>,
  lite: boolean,
  db: Queryable = pool,
): Promise<number> {
  const t = now();
  const base: Record<string, unknown> = {
    m_msg_type: type,
    m_msg_template_name: templateName,
    m_title: phpDate('d-M-Y H:i:s', t),
    m_content: '',
    m_msg_template_para: '',
    m_image: '',
    m_carousel: null,
    m_user_id: userId,
    m_sheet_id: '',
    m_campaign_id: campaignId,
    m_source: 2,
    m_is_incoming: 2,
    m_msg_lite: lite ? 1 : 2,
    m_status: 1,
    m_created_date: dayStart(t),
    m_created_on: t,
    ...fields,
  };
  const cols = Object.keys(base);
  const values = cols.map((c) => base[c]);
  // Parameters in a SELECT list are untyped: numbers go in as bigint (assignment-cast to int/smallint), the rest as text
  const casts = values.map((v, i) => `$${i + 2}::${typeof v === 'number' ? 'bigint' : 'text'}`);
  const sql = `INSERT INTO js_message (m_mobile_no, m_unique_id, ${cols.join(', ')})
               SELECT n, gen_random_uuid()::text, ${casts.join(', ')} FROM unnest($1::text[]) AS n`;
  let count = 0;
  for (let i = 0; i < numbers.length; i += 5000) {
    const res = await db.query(sql, [numbers.slice(i, i + 5000), ...values]);
    count += res.rowCount ?? 0;
  }
  return count;
}

/**
 * Free-form reply from the inbox, optionally with one attachment (sent as
 * its caption); marked for immediate sending (legacy save_msg.php).
 */
export async function chatReply(user: Pick<UserRow, 'u_id' | 'u_code'>, mobile: string, text: string, file: File | null = null): Promise<MessageRow> {
  const m = mobile.trim();
  const t = now();
  const message = await insertMessage({
    m_msg_type: 'text',
    m_content: text,
    m_image: file ? await storePublic(file, 'chat/' + (user.u_code || user.u_id)) : null,
    m_mobile_no: m,
    m_contact_id: await contactId(user.u_id, m),
    m_user_id: user.u_id,
    m_is_incoming: 2,
    m_status: 6,
    m_source: 2,
    m_in_process_on: t,
    m_created_date: dayStart(t),
    m_created_on: t,
  });
  await recordMessage(message);
  return message;
}

/**
 * Message posted through the public API. `data` is the decoded JSON body.
 * Bot / OTP messages are marked for immediate sending (status 6).
 */
export async function messageFromApi(user: Pick<UserRow, 'u_id'>, type: string, data: Record<string, any>, baseFile = '', templateEndpoint = false): Promise<MessageRow> {
  const receiver = data.receiverMobileNo ?? '';
  const mobile = (Array.isArray(receiver) ? receiver.join(',') : String(receiver)).replace(/ /g, '').trim();
  let text = data.message ?? '';
  text = Array.isArray(text) ? String(text[0] ?? '') : String(text);

  const immediate = String(data.bot ?? '') === '1' || String(data.opt ?? '') === '1';
  if (!templateEndpoint) {
    if (String(data.opt ?? '') === '1') type = 'Authentication';
    if (data.type) type = String(data.type);
  }
  const images = templateEndpoint ? (data.attachment ?? '') : (data.filePathUrl ?? []);
  const t = now();

  const row: Partial<MessageRow> = {
    m_msg_type: type,
    m_unique_id: randomUUID(),
    m_title: phpDate('d-M-Y H:i:s', t),
    m_content: templateEndpoint ? '' : text,
    m_contact_id: await contactId(user.u_id, mobile),
    m_mobile_no: mobile,
    m_image: Array.isArray(images) ? images.join(',') : String(images ?? ''),
    m_base_file: baseFile,
    m_user_id: user.u_id,
    m_status: immediate ? 6 : 1,
    m_sheet_id: templateEndpoint ? 'API' : String(data.sheet_id ?? ''),
    m_source: 2,
    m_is_incoming: 2,
    m_created_date: dayStart(t),
    m_created_on: t,
  };
  if (!templateEndpoint && Array.isArray(data.messageButtons) && data.messageButtons[0] !== undefined) {
    row.m_buttons = String(data.messageButtons[0]);
    row.m_msg_title = data.title ?? null;
  }
  if (data.msg_values !== undefined) row.m_msg_values = limit(JSON.stringify(data.msg_values), 250, '');
  if (data.template !== undefined) row.m_msg_template_name = String(data.template);
  if (data.template_parameters !== undefined) {
    const p = data.template_parameters;
    row.m_msg_template_para = limit(Array.isArray(p) ? p.join(',') : String(p), 250, '');
  }
  if (data.urlButtons !== undefined) row.m_button_url = String(data.urlButtons);
  if (immediate) row.m_in_process_on = t;

  return insertMessage(row);
}

/**
 * Store an incoming webhook message and apply opt-out keywords.
 * `data` holds js_message columns (m_mobile_no, m_sender_name, m_content, …).
 */
export async function storeIncoming(user: Pick<UserRow, 'u_id'>, data: Partial<MessageRow> & { m_mobile_no: string }): Promise<MessageRow> {
  const cid = await contactId(user.u_id, data.m_mobile_no, data.m_sender_name ?? null);
  const t = now();
  const message = await insertMessage({
    m_user_id: user.u_id,
    m_is_incoming: 1,
    m_contact_id: cid,
    m_source: 2,
    m_status: 3,
    m_created_on: t,
    m_created_date: dayStart(t),
    ...data,
  });
  await recordMessage(message);

  if (config.optOutKeywords.includes(String(data.m_content ?? '').trim().toLowerCase())) {
    // The legacy block-list table could not store emoji; keep printable ASCII for the name
    const name = String(data.m_sender_name ?? '').replace(/[^\x20-\x7E]/g, '');
    await blockNumber(user.u_id, data.m_mobile_no, name, 2);
    if (cid) await exec('UPDATE js_user_contact_list SET cl_opt_out = 1 WHERE cl_id = $1', [cid]);
  }
  return message;
}

/** Messages already queued for a campaign (diagnostics / tests). */
export function campaignMessages(campaignId: number) {
  return query<MessageRow>('SELECT * FROM js_message WHERE m_campaign_id = $1 ORDER BY m_id', [campaignId]);
}
