import 'server-only';
import { randomUUID } from 'node:crypto';
import { after } from 'next/server';
import { fileExt } from '../actions';
import { config } from '../config';
import { one, query, value } from '../db';
import { countVariables, templateButtons, templateCards, templateParameterCount, templateVariables } from '../format';
import { contactId, recordMessage } from '../models';
import { normalizePhone } from '../phone';
import { categoryAllowed, categoryRefusal, creatableCategories } from '../template-categories';
import { decodeEntities, jsonParse } from '../text';
import { dayStart, now, phpDate } from '../time';
import { USER_TYPE, type MessageRow, type TemplateRow, type UserRow } from '../types';
import { storePublic } from '../services/media';
import { insertMessage, UserError } from '../services/messages';
import { mapLimit, sendPending } from '../services/sender';
import { templateQuota } from '../services/template-limit';
import { createStandardTemplate, syncTemplates, type ButtonInput, type TemplateInput } from '../services/templates';
import { LANGUAGES } from '@/app/(user)/templates/create/languages';

/**
 * REST API v2 for WhatsApp accounts, authenticated with the account's API key
 * (Profile → API Access Key) in an `X-API-Key` header (or `Authorization: Bearer`).
 *
 *   GET  /api/v2/templates               approved templates (?status=all, ?name=, ?category=, ?sync=1)
 *   POST /api/v2/templates               create a template (submitted to WhatsApp for review)
 *   POST /api/v2/messages/template       send a template: parameters, header media / text, URL buttons, carousel
 *   POST /api/v2/messages/text           send a text message (inside the 24-hour reply window)
 *   POST /api/v2/messages/media          send an attachment with an optional caption (inside the window)
 *   GET  /api/v2/messages/{id}           status of a message
 *
 * Bodies are JSON, or multipart/form-data when uploading a file. Responses are
 * {"success": true, "data": …} or {"success": false, "error": {"code", "message", "field"?}}.
 * Messages go out straight away (API messages are not held to the campaign sending hours).
 */

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public field?: string) {
    super(message);
  }
}

export type ApiUser = UserRow;
type Ctx<P> = { params: Promise<P> };
type Handler<P> = (req: Request, user: ApiUser, params: P) => Promise<Response>;

const MAX_RECIPIENTS = 100;
const MAX_FILE = 16 * 1024 * 1024;
const HEADERS = { 'Cache-Control': 'no-store' };

export function ok(data: unknown, status = 200): Response {
  return Response.json({ success: true, data }, { status, headers: HEADERS });
}

function errorResponse(e: ApiError): Response {
  return Response.json(
    { success: false, error: { code: e.code, message: e.message, ...(e.field ? { field: e.field } : {}) } },
    { status: e.status, headers: HEADERS },
  );
}

const invalid = (field: string, message: string) => new ApiError(422, 'validation_error', message, field);

/**
 * Wrap a route handler: authenticate the API key, turn ApiError / UserError
 * into JSON errors. `sending` endpoints also need an active WhatsApp plan.
 */
export function api<P = Record<string, never>>(handler: Handler<P>, opts: { sending?: boolean } = {}) {
  return async (req: Request, ctx: Ctx<P>): Promise<Response> => {
    try {
      const user = await authenticate(req, !!opts.sending);
      return await handler(req, user, ctx?.params ? await ctx.params : ({} as P));
    } catch (e) {
      if (e instanceof ApiError) return errorResponse(e);
      if (e instanceof UserError) return errorResponse(new ApiError(422, 'validation_error', e.message));
      console.error('[api v2]', req.method, new URL(req.url).pathname, e);
      return errorResponse(new ApiError(500, 'server_error', 'Something went wrong. Please try again.'));
    }
  };
}

async function authenticate(req: Request, sending: boolean): Promise<ApiUser> {
  const auth = req.headers.get('authorization') ?? '';
  const key = (req.headers.get('x-api-key') ?? (/^Bearer\s+(.+)$/i.exec(auth)?.[1] ?? '')).trim();
  if (key === '') throw new ApiError(401, 'missing_api_key', 'Send your API key in the X-API-Key header.');
  const user = await one<ApiUser>(
    'SELECT * FROM js_user WHERE u_access_code = $1 AND u_dstatus = 0 AND u_type = $2 ORDER BY u_id LIMIT 1',
    [key, USER_TYPE.WHATSAPP],
  );
  if (!user) throw new ApiError(401, 'invalid_api_key', 'The API key is not valid.');
  if (Number(user.u_status) !== 1) throw new ApiError(403, 'account_inactive', 'This account is inactive.');
  if (sending && Number(user.u_wa_plan_status) !== 1) throw new ApiError(403, 'plan_expired', 'The WhatsApp plan of this account has expired.');
  if (!user.u_wa_phone_id) throw new ApiError(403, 'whatsapp_not_connected', 'This account has no WhatsApp number connected yet.');
  return user;
}

// ------------------------------------------------------------------ request body

interface Body {
  get(name: string): unknown;
  str(name: string): string;
  list(name: string): unknown[];
  obj(name: string): Record<string, unknown> | unknown[] | null;
  file(name: string): File | null;
}

/** JSON, multipart/form-data or urlencoded. In forms, list / object fields may be sent as JSON strings or repeated `name[]` keys. */
export async function readBody(req: Request): Promise<Body> {
  const type = req.headers.get('content-type') ?? '';
  if (type.includes('multipart/form-data') || type.includes('application/x-www-form-urlencoded')) {
    let fd: FormData;
    try {
      fd = await req.formData();
    } catch {
      throw new ApiError(400, 'invalid_body', 'The request body could not be read as form data.');
    }
    const strOf = (n: string) => {
      const v = fd.get(n);
      return typeof v === 'string' ? v.trim() : '';
    };
    const parsed = (n: string): unknown => {
      const s = strOf(n);
      return s.startsWith('[') || s.startsWith('{') ? jsonParse<unknown>(s, null) : null;
    };
    return {
      get: (n) => fd.get(n),
      str: strOf,
      list: (n) => {
        const j = parsed(n);
        if (Array.isArray(j)) return j;
        const many = [...fd.getAll(`${n}[]`), ...fd.getAll(n)].filter((v): v is string => typeof v === 'string');
        return many;
      },
      obj: (n) => {
        const j = parsed(n);
        return j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
      },
      file: (n) => {
        const f = fd.get(n);
        return f instanceof File && f.size > 0 ? f : null;
      },
    };
  }
  let data: Record<string, unknown> = {};
  try {
    const text = await req.text();
    data = text.trim() === '' ? {} : JSON.parse(text);
  } catch {
    throw new ApiError(400, 'invalid_json', 'The request body is not valid JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ApiError(400, 'invalid_json', 'The request body must be a JSON object.');
  return {
    get: (n) => data[n],
    str: (n) => (data[n] == null ? '' : typeof data[n] === 'object' ? '' : String(data[n]).trim()),
    list: (n) => (Array.isArray(data[n]) ? (data[n] as unknown[]) : data[n] == null || data[n] === '' ? [] : [data[n]]),
    obj: (n) => (data[n] && typeof data[n] === 'object' ? (data[n] as Record<string, unknown>) : null),
    file: () => null,
  };
}

// ------------------------------------------------------------------ helpers

/** Recipients from `to`: a number, a comma-separated list or an array. */
function recipients(body: Body, max: number): string[] {
  const raw = body.list('to').flatMap((v) => String(v ?? '').split(/[\s,;]+/)).filter((v) => v !== '');
  if (!raw.length) throw invalid('to', 'The to field is required.');
  const out = new Set<string>();
  for (const r of raw) {
    const n = normalizePhone(r);
    if (!n) throw invalid('to', `"${r}" is not a valid mobile number. Include the country code, e.g. 919876543210.`);
    out.add(n);
  }
  if (out.size > max) throw invalid('to', max === 1 ? 'Send to one number at a time.' : `Send to at most ${max} numbers per request.`);
  return [...out];
}

const extOfUrl = (u: string) => {
  try {
    return (/\.([A-Za-z0-9]+)$/.exec(new URL(u).pathname)?.[1] ?? '').toLowerCase();
  } catch {
    return '';
  }
};

function checkUrl(field: string, u: string, allowed: string[]): string {
  if (!/^https?:\/\/\S+$/i.test(u)) throw invalid(field, `The ${field} must be a public http(s) URL.`);
  const ext = extOfUrl(u);
  if (!allowed.includes(ext)) throw invalid(field, `The ${field} must end in a file extension: ${allowed.join(', ')}.`);
  return u;
}

async function storeUpload(user: ApiUser, field: string, f: File, allowed: string[], maxBytes = MAX_FILE): Promise<string> {
  if (!allowed.includes(fileExt(f))) throw invalid(field, `The ${field} must be a file of type: ${allowed.join(', ')}.`);
  if (f.size > maxBytes) throw invalid(field, `The ${field} must not be larger than ${Math.round(maxBytes / 1048576)} MB.`);
  return storePublic(f, `api/${user.u_code || user.u_id}`);
}

const strings = (list: unknown[]) => list.map((v) => (v == null ? '' : String(v)));

/** Button values: an array by button index (null to skip) or an object {"0": "…"}. */
function buttonValues(raw: Record<string, unknown> | unknown[] | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const [k, v] of Object.entries(raw)) if (/^\d+$/.test(k) && v != null && String(v) !== '') out[k] = String(v);
  return out;
}

/** API view of a message row. */
export function messageView(m: MessageRow) {
  const status = Number(m.m_status);
  const err = jsonParse<any[]>(m.m_status_response ?? '', []);
  const errorText = Array.isArray(err) ? err[0]?.error?.message ?? null : null;
  let state: string;
  if (status === 1 || status === 8) state = 'queued';
  else if (status === 6) state = 'processing';
  else if (status === 9) state = 'opted_out';
  else if (status === 3 && !m.m_message_id) state = 'failed';
  else if (status === 3) state = m.m_delivery_status === 'error' ? 'failed' : (m.m_delivery_status || 'sent');
  else state = 'cancelled';
  return {
    id: m.m_unique_id,
    to: m.m_mobile_no,
    type: m.m_msg_type,
    template: m.m_msg_template_name || null,
    status: state,
    error: state === 'failed' || state === 'cancelled' ? (errorText ?? (m.m_status_response || config.messageStatus[status] || null)) : null,
    whatsapp_message_id: m.m_message_id || null,
    created_at: m.m_created_on ? phpDate('Y-m-d H:i:s', Number(m.m_created_on)) : null,
    updated_at: m.m_updated_on ? phpDate('Y-m-d H:i:s', Number(m.m_updated_on)) : null,
  };
}

/** Insert one outgoing API message per number, marked for immediate sending. */
async function createMessages(user: ApiUser, numbers: string[], fields: Partial<MessageRow>): Promise<MessageRow[]> {
  const t = now();
  const rows: MessageRow[] = [];
  for (const mobile of numbers) {
    const m = await insertMessage({
      m_unique_id: randomUUID(),
      m_title: phpDate('d-M-Y H:i:s', t),
      m_content: '',
      m_mobile_no: mobile,
      m_contact_id: await contactId(user.u_id, mobile),
      m_user_id: user.u_id,
      m_sheet_id: 'API',
      m_source: 2,
      m_is_incoming: 2,
      m_status: 6,
      m_in_process_on: t,
      m_created_date: dayStart(t),
      m_created_on: t,
      ...fields,
    });
    await recordMessage(m);
    rows.push(m);
  }
  return rows;
}

/**
 * Send: one recipient is sent before answering (so the response carries the
 * WhatsApp result); several go out right after the response.
 */
async function dispatch(rows: MessageRow[]): Promise<Response> {
  if (rows.length === 1) {
    await sendPending(rows[0].m_id).catch((e) => console.error('[api v2] send failed', rows[0].m_id, e));
    const m = (await one<MessageRow>('SELECT * FROM js_message WHERE m_id = $1', [rows[0].m_id])) ?? rows[0];
    const view = messageView(m);
    return ok({ messages: [view] }, view.status === 'failed' ? 200 : 201);
  }
  const ids = rows.map((r) => r.m_id);
  after(() => mapLimit(ids, 5, (id) => sendPending(id).catch((e) => console.error('[api v2] send failed', id, e))));
  return ok({ messages: rows.map((r) => ({ ...messageView(r), status: 'processing' })) }, 202);
}

/** Last time the customer wrote to this account: free-form messages need the 24-hour window. */
async function requireWindow(user: ApiUser, mobile: string): Promise<void> {
  const cc = config.countryCode;
  const variants = [...new Set([mobile, cc + mobile, '+' + cc + mobile, mobile.replace(new RegExp('^' + cc), '')])];
  const last = Number(await value<number>(
    'SELECT MAX(m_created_on) FROM js_message WHERE m_user_id = $1 AND m_mobile_no = ANY($2::text[]) AND m_is_incoming = 1 AND m_dstatus = 0',
    [user.u_id, variants],
  )) || 0;
  if (last + 86400 <= now()) {
    throw new ApiError(422, 'window_closed', 'The customer has not written in the last 24 hours, so only a template message can be sent.', 'to');
  }
}

// ------------------------------------------------------------------ templates

type TemplateFull = TemplateRow & { ut_parameters: string | null };

function templateView(t: TemplateFull) {
  const headerType = String(t.ut_header_type ?? '').toUpperCase() || (t.ut_header ? 'TEXT' : 'NONE');
  const header = decodeEntities(t.ut_header ?? '');
  return {
    id: Number(t.ut_id),
    name: t.ut_name,
    language: t.ut_language,
    category: t.ut_template_category,
    type: t.ut_template_type,
    status: Number(t.ut_status) === 1 ? 'APPROVED' : 'INACTIVE',
    header: headerType === 'NONE' ? null : {
      type: headerType,
      ...(headerType === 'TEXT' ? { text: header, parameters: templateVariables(header).length } : { sample_url: header || null }),
    },
    body: decodeEntities(t.ut_message ?? ''),
    body_parameters: templateParameterCount(t),
    footer: decodeEntities(t.ut_footer ?? '') || null,
    buttons: templateButtons(t).map((b, i) => ({
      index: i,
      type: b.type ?? null,
      text: b.text ?? '',
      ...(b.url ? { url: b.url, dynamic: templateVariables(b.url).length > 0 } : {}),
      ...((b as any).phone_number ? { phone_number: (b as any).phone_number } : {}),
    })),
    cards: t.ut_template_type === 'carousel'
      ? templateCards(t).map((c, i) => ({
        index: i,
        header_type: c.header_type,
        body: c.body,
        body_parameters: countVariables(c.body),
        buttons: (c.buttons ?? []).map((b, j) => ({ index: j, type: b.type ?? null, text: b.text ?? '', ...(b.url ? { url: b.url, dynamic: templateVariables(b.url).length > 0 } : {}) })),
      }))
      : [],
  };
}

/** GET /api/v2/templates */
export async function listTemplates(req: Request, user: ApiUser): Promise<Response> {
  const q = new URL(req.url).searchParams;
  if (q.get('sync') === '1') {
    if (!user.u_wa_b_id) throw new ApiError(403, 'whatsapp_not_connected', 'This account has no WhatsApp Business Account connected.');
    await syncTemplates(user);
  }
  const all = q.get('status') === 'all';
  const name = (q.get('name') ?? '').trim();
  const category = (q.get('category') ?? '').trim().toUpperCase();
  const rows = await query<TemplateFull>(
    `SELECT * FROM js_user_templates
      WHERE ut_user_id = $1 AND ut_dstatus = 0 AND ($2 OR ut_status = 1)
        AND ($3 = '' OR ut_name = $3) AND ($4 = '' OR upper(ut_template_category) = $4)
      ORDER BY ut_name, ut_language`,
    [user.u_id, all, name, category],
  );
  return ok({
    templates: rows.map((t) => ({ ...templateView(t), can_send: Number(t.ut_status) === 1 && categoryAllowed(user.u_template_categories, t.ut_template_category) })),
  });
}

const HEADER_MEDIA: Record<string, string[]> = {
  IMAGE: ['jpg', 'jpeg', 'png'],
  VIDEO: ['mp4', '3gp'],
  DOCUMENT: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv'],
};

/** POST /api/v2/messages/template */
export async function sendTemplate(req: Request, user: ApiUser): Promise<Response> {
  const body = await readBody(req);
  const numbers = recipients(body, MAX_RECIPIENTS);
  const name = body.str('template');
  if (name === '') throw invalid('template', 'The template field is required (the template name).');
  const language = body.str('language');

  const t = await one<TemplateFull>(
    `SELECT * FROM js_user_templates WHERE ut_user_id = $1 AND ut_name = $2 AND ut_dstatus = 0 AND ($3 = '' OR ut_language = $3)
      ORDER BY ut_status, ut_id DESC LIMIT 1`,
    [user.u_id, name, language],
  );
  if (!t) throw new ApiError(404, 'template_not_found', `No template named "${name}"${language ? ` in ${language}` : ''}. Use GET /api/v2/templates?sync=1 to refresh the list.`, 'template');
  if (Number(t.ut_status) !== 1) throw new ApiError(422, 'template_not_approved', `The template "${name}" is not approved.`, 'template');
  if (!categoryAllowed(user.u_template_categories, t.ut_template_category)) {
    throw new ApiError(403, 'category_not_allowed', categoryRefusal(user.u_template_categories), 'template');
  }

  // Body parameters ({{1}}, {{2}}, …)
  const params = strings(body.list('parameters'));
  const expected = templateParameterCount(t);
  if (params.length !== expected) {
    throw invalid('parameters', expected
      ? `The template "${name}" needs ${expected} body parameter(s) ({{1}}…{{${expected}}}); ${params.length} given.`
      : `The template "${name}" has no body parameters; ${params.length} given.`);
  }
  if (params.some((p) => p.trim() === '')) throw invalid('parameters', 'Body parameters must not be empty.');
  if (params.some((p) => p.length > 1024)) throw invalid('parameters', 'A body parameter must not be longer than 1024 characters.');

  const fields: Partial<MessageRow> = { m_msg_template_name: t.ut_name };
  const values: { body: string[]; header?: string; buttons?: Record<string, string> } = { body: params };
  const type = String(t.ut_template_type ?? 'template');

  if (type === 'carousel') {
    const cards = templateCards(t);
    const given = body.list('cards');
    if (given.length !== cards.length) throw invalid('cards', `The template "${name}" has ${cards.length} card(s); send one entry in "cards" for each.`);
    const carousel = cards.map((card, i) => {
      const c = (given[i] && typeof given[i] === 'object' ? given[i] : {}) as Record<string, unknown>;
      const allowed = card.header_type === 'VIDEO' ? ['mp4'] : ['jpg', 'jpeg', 'png'];
      const media = checkUrl(`cards.${i}.media_url`, String(c.media_url ?? ''), allowed);
      const cardParams = strings(Array.isArray(c.parameters) ? c.parameters : []);
      const need = countVariables(card.body);
      if (cardParams.length !== need) throw invalid(`cards.${i}.parameters`, `Card ${i + 1} needs ${need} parameter(s); ${cardParams.length} given.`);
      const urlParams = buttonValues((c.button_parameters ?? null) as Record<string, unknown> | null);
      (card.buttons ?? []).forEach((b, j) => {
        if (b.type === 'URL' && templateVariables(b.url).length && !urlParams[j]) {
          throw invalid(`cards.${i}.button_parameters`, `Card ${i + 1}: button ${j} ("${b.text}") has a dynamic URL; send its value in button_parameters.`);
        }
      });
      return { media, params: cardParams, url_params: urlParams };
    });
    fields.m_carousel = JSON.stringify(carousel);
  } else {
    // Header: media (URL or upload) or a text header with {{1}}
    const headerType = String(t.ut_header_type ?? '').toUpperCase();
    const headerUrl = body.str('header_url');
    const headerFile = body.file('header_file');
    if (HEADER_MEDIA[headerType]) {
      if (headerFile) fields.m_image = await storeUpload(user, 'header_file', headerFile, HEADER_MEDIA[headerType], headerType === 'IMAGE' ? 5 * 1048576 : MAX_FILE);
      else if (headerUrl) fields.m_image = checkUrl('header_url', headerUrl, HEADER_MEDIA[headerType]);
      else throw invalid('header_url', `The template "${name}" has ${headerType === "IMAGE" ? "an" : "a"} ${headerType.toLowerCase()} header: send header_url (or upload header_file).`);
    } else if (headerUrl || headerFile) {
      throw invalid('header_url', `The template "${name}" has no media header.`);
    }
    if ((headerType === 'TEXT' || (!headerType && t.ut_header)) && templateVariables(decodeEntities(t.ut_header ?? '')).length) {
      const hp = body.str('header_parameter');
      if (hp === '') throw invalid('header_parameter', `The template "${name}" has a variable in its header: send header_parameter.`);
      values.header = hp;
    }
    // Dynamic URL buttons: the value replaces {{1}} at the end of the button URL
    const given = buttonValues(body.obj('button_parameters'));
    const buttons: Record<string, string> = {};
    templateButtons(t).forEach((b, i) => {
      if (b.type !== 'URL' || !templateVariables(b.url).length) return;
      if (!given[String(i)]) throw invalid('button_parameters', `Button ${i} ("${b.text}") has a dynamic URL; send its value in button_parameters (e.g. {"${i}": "abc123"}).`);
      buttons[String(i)] = given[String(i)];
    });
    if (Object.keys(buttons).length) values.buttons = buttons;
  }
  fields.m_msg_type = ['template', 'flow', 'carousel', 'Authentication'].includes(type) ? type : 'template';
  fields.m_msg_template_para = JSON.stringify(values);
  fields.m_msg_lite = String(t.ut_template_category ?? '').toUpperCase() === 'MARKETING' && Number(user.u_is_new_no) === 1 ? 1 : 2;

  const quota = await templateQuota(user.u_id);
  if (quota.remaining !== null && quota.remaining < numbers.length) {
    throw new ApiError(403, 'limit_reached', quota.remaining === 0
      ? 'The template message limit of this account has been reached.'
      : `Only ${quota.remaining} template message(s) left on this account's limit.`);
  }
  return dispatch(await createMessages(user, numbers, fields));
}

/** POST /api/v2/messages/text */
export async function sendText(req: Request, user: ApiUser): Promise<Response> {
  const body = await readBody(req);
  const [to] = recipients(body, 1);
  const text = body.str('text');
  if (text === '') throw invalid('text', 'The text field is required.');
  if (text.length > 4096) throw invalid('text', 'The text must not be longer than 4096 characters.');
  const buttons = strings(body.list('buttons')).map((b) => b.trim()).filter((b) => b !== '');
  if (buttons.length > 10) throw invalid('buttons', 'At most 10 reply buttons (3 show as buttons, more as a list).');
  if (buttons.some((b) => b.includes(','))) throw invalid('buttons', 'Button titles must not contain commas.');
  if (buttons.some((b) => b.length > (buttons.length <= 3 ? 20 : 24))) throw invalid('buttons', `Button titles must not be longer than ${buttons.length <= 3 ? 20 : 24} characters.`);
  await requireWindow(user, to);
  return dispatch(await createMessages(user, [to], { m_msg_type: 'text', m_content: text, m_buttons: buttons.length ? buttons.join(',') : null }));
}

const ATTACHMENTS = ['jpg', 'jpeg', 'png', 'webp', 'mp4', '3gp', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv'];

/** POST /api/v2/messages/media */
export async function sendMedia(req: Request, user: ApiUser): Promise<Response> {
  const body = await readBody(req);
  const [to] = recipients(body, 1);
  const caption = body.str('caption');
  if (caption.length > 1024) throw invalid('caption', 'The caption must not be longer than 1024 characters.');
  const file = body.file('file');
  const mediaUrl = body.str('url');
  if (!file && !mediaUrl) throw invalid('url', 'Send the attachment as url (a public link) or upload it as file (multipart/form-data).');
  if (!file) checkUrl('url', mediaUrl, ATTACHMENTS);
  await requireWindow(user, to);
  const link = file ? await storeUpload(user, 'file', file, ATTACHMENTS) : mediaUrl;
  return dispatch(await createMessages(user, [to], { m_msg_type: 'text', m_content: caption, m_image: link }));
}

/** GET /api/v2/messages/{id} */
export async function messageStatus(_req: Request, user: ApiUser, params: { id: string }): Promise<Response> {
  const m = await one<MessageRow>('SELECT * FROM js_message WHERE m_unique_id = $1 AND m_user_id = $2 AND m_is_incoming = 2 LIMIT 1', [params.id, user.u_id]);
  if (!m) throw new ApiError(404, 'message_not_found', 'No message with this id.');
  return ok({ message: messageView(m) });
}

// ------------------------------------------------------------------ create template

const BUTTON_TYPES = ['QUICK_REPLY', 'URL', 'PHONE_NUMBER'];
const TEMPLATE_FILES: Record<string, { ext: string[]; max: number }> = {
  IMAGE: { ext: ['jpg', 'jpeg', 'png'], max: 5 * 1048576 },
  VIDEO: { ext: ['mp4'], max: 16 * 1048576 },
  DOCUMENT: { ext: ['pdf'], max: 100 * 1048576 },
};

/**
 * POST /api/v2/templates — standard template (header, body, footer, buttons),
 * submitted to WhatsApp for review. Media headers need a sample upload
 * (multipart `header_file`). Carousel templates are created in the panel.
 */
export async function createTemplate(req: Request, user: ApiUser): Promise<Response> {
  if (!user.u_wa_b_id) throw new ApiError(403, 'whatsapp_not_connected', 'This account has no WhatsApp Business Account connected.');
  const body = await readBody(req);

  const name = body.str('name');
  if (name === '') throw invalid('name', 'The name field is required.');
  if (!/^[a-z0-9_]{1,512}$/.test(name)) throw invalid('name', 'The name may only contain lowercase letters, numbers and underscores.');
  const category = body.str('category').toUpperCase();
  const categories = creatableCategories(user.u_template_categories);
  if (!(categories as string[]).includes(category)) throw invalid('category', `The category must be one of: ${categories.join(', ')}.`);
  const language = body.str('language') || 'en';
  if (!LANGUAGES[language]) throw invalid('language', 'Unknown language code (e.g. en, en_US, hi).');

  const text = body.str('body');
  if (text === '') throw invalid('body', 'The body field is required.');
  if (text.length > 1024) throw invalid('body', 'The body must not be longer than 1024 characters.');
  const vars = templateVariables(text);
  if (vars.some((n, i) => n !== i + 1)) throw invalid('body', 'Body variables must be numbered {{1}}, {{2}}, … without gaps.');
  const examples = strings(body.list('body_examples'));
  if (vars.length && (examples.length !== vars.length || examples.some((e) => e.trim() === ''))) {
    throw invalid('body_examples', `Send ${vars.length} sample value(s) in body_examples, one per body variable (WhatsApp reviews them).`);
  }

  const headerType = (body.str('header_type') || 'NONE').toUpperCase();
  if (!['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType)) throw invalid('header_type', 'The header_type must be NONE, TEXT, IMAGE, VIDEO or DOCUMENT.');
  const headerText = body.str('header_text');
  const headerExample = body.str('header_example');
  if (headerType === 'TEXT') {
    if (headerText === '') throw invalid('header_text', 'The header_text field is required when header_type is TEXT.');
    if (headerText.length > 60) throw invalid('header_text', 'The header_text must not be longer than 60 characters.');
    const hv = templateVariables(headerText);
    if (hv.length && (hv.length !== 1 || hv[0] !== 1)) throw invalid('header_text', 'The header can contain only one variable, {{1}}.');
    if (hv.length && headerExample === '') throw invalid('header_example', 'Send a sample value for the header variable in header_example.');
  }
  const headerFile = body.file('header_file');
  if (TEMPLATE_FILES[headerType]) {
    const rule = TEMPLATE_FILES[headerType];
    if (!headerFile) throw invalid('header_file', `${headerType === 'IMAGE' ? 'An' : 'A'} ${headerType.toLowerCase()} header needs a sample file: upload header_file (multipart/form-data).`);
    if (!rule.ext.includes(fileExt(headerFile))) throw invalid('header_file', `The header_file must be a file of type: ${rule.ext.join(', ')}.`);
    if (headerFile.size > rule.max) throw invalid('header_file', `The header_file must not be larger than ${Math.round(rule.max / 1048576)} MB.`);
  }
  const footer = body.str('footer');
  if (footer.length > 60) throw invalid('footer', 'The footer must not be longer than 60 characters.');

  const rawButtons = body.list('buttons');
  if (rawButtons.length > 10) throw invalid('buttons', 'A template can have at most 10 buttons.');
  const buttons: ButtonInput[] = rawButtons.map((raw, i) => {
    const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const f = `buttons.${i}`;
    const type = String(b.type ?? '').toUpperCase();
    const label = String(b.text ?? '').trim();
    if (!BUTTON_TYPES.includes(type)) throw invalid(`${f}.type`, `The ${f}.type must be QUICK_REPLY, URL or PHONE_NUMBER.`);
    if (label === '' || label.length > 25) throw invalid(`${f}.text`, `The ${f}.text is required (at most 25 characters).`);
    const out: ButtonInput = { type, text: label };
    if (type === 'URL') {
      const u = String(b.url ?? '').trim();
      if (!/^https?:\/\/\S+$/.test(u) || u.length > 2000) throw invalid(`${f}.url`, `The ${f}.url must be an http(s) URL.`);
      const uv = templateVariables(u);
      if (uv.length && (uv.length !== 1 || uv[0] !== 1 || !u.endsWith('}}'))) throw invalid(`${f}.url`, 'A dynamic URL may only end in {{1}}.');
      const example = String(b.example ?? '').trim();
      if (uv.length && !example) throw invalid(`${f}.example`, `Send a full sample URL in ${f}.example for the dynamic URL.`);
      out.url = u;
      if (example) out.example = example;
    } else if (type === 'PHONE_NUMBER') {
      const phone = String(b.phone ?? b.phone_number ?? '').trim();
      if (!/^\+?\d{8,15}$/.test(phone)) throw invalid(`${f}.phone`, 'The phone number must include the country code, e.g. +919876543210.');
      out.phone = phone;
    }
    return out;
  });

  if (await value('SELECT 1 FROM js_user_templates WHERE ut_user_id = $1 AND ut_name = $2 AND ut_language = $3 AND ut_dstatus = 0 LIMIT 1', [user.u_id, name, language])) {
    throw new ApiError(409, 'template_exists', `A template named "${name}" in ${language} already exists.`, 'name');
  }

  const data: TemplateInput = {
    name, language, category, header_type: headerType,
    header_text: headerText || undefined, header_example: headerExample || undefined,
    body: text, body_example: Object.fromEntries(examples.map((e, i) => [i + 1, e])), footer: footer || undefined, buttons,
  };
  const result = await createStandardTemplate(user, data, headerFile);
  if (!result.ok) throw new ApiError(422, 'whatsapp_rejected', result.message);
  await syncTemplates(user).catch((e) => console.error('[api v2] template sync failed', e));
  return ok({ template: { name, language, category, status: result.status ?? 'PENDING' } }, 201);
}
