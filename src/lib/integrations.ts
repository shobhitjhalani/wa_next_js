import 'server-only';
import { createHmac } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after } from 'next/server';
import { config } from './config';
import { exec, insert, one, value } from './db';
import { contactId } from './models';
import { checkPassword, safeEqual } from './password';
import { limit, randomString } from './text';
import { dayStart, now, phpDate } from './time';
import { USER_TYPE, type UserRow } from './types';
import { insertMessage, messageFromApi } from './services/messages';
import { isLimitedType, templateQuota } from './services/template-limit';
import { sendPending } from './services/sender';
import { handleWebhook } from './services/webhook';

/**
 * Integration endpoints on the legacy URLs, so existing clients, the Meta
 * app and the Shopify store keep working unchanged:
 *   /api/secure/v1/{action}/        public API (waapi/api.php)
 *   /waapi/client_api.php?at=send_wa
 *   /api/shopify/v1/{action}/       Shopify webhooks
 *   /waapi/webhook(.php)            Meta webhook
 *   /waapi/igwebhook.php            Instagram (log + ack)
 * Messages that must go out immediately are sent after the response
 * (next/server after()), so callers get their answer without waiting for Meta.
 */

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** Request input like Laravel $request->input(): query string merged with a form or JSON body. */
export async function readInput(req: Request): Promise<{ raw: string; data: Record<string, any>; input: Record<string, any> }> {
  const raw = await req.text();
  const input: Record<string, any> = Object.fromEntries(new URL(req.url).searchParams);
  let data: Record<string, any> = {};
  const type = req.headers.get('content-type') ?? '';
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') data = parsed;
    } catch {
      data = {};
    }
    if (type.includes('application/x-www-form-urlencoded')) {
      Object.assign(input, Object.fromEntries(new URLSearchParams(raw)));
    } else if (type.includes('multipart/form-data')) {
      try {
        const fd = await new Response(raw, { headers: { 'content-type': type } }).formData();
        for (const [k, v] of fd) if (typeof v === 'string') input[k] = v;
      } catch { /* ignore malformed multipart */ }
    } else {
      Object.assign(input, data);
    }
  }
  return { raw, data, input };
}

function reply(status: unknown, message: string, result: unknown = []) {
  return json({ status, message, result });
}

async function apiLog(row: Record<string, unknown>) {
  await insert('js_api_data_log', row, 'adl_id').catch((e) => console.error('[api] log failed', e));
}

// ------------------------------------------------------------------ public API

/** POST /api/secure/v1/{action}/ (legacy waapi/api.php). */
export async function handleApi(req: Request, action: string): Promise<Response> {
  const { raw, data, input } = await readInput(req);
  switch (action) {
    case 'create_wa':
    case 'send_message': return createMessage(data, 'text', false);
    case 'send_template': return createMessage(data, 'template', true);
    case 'status_wa': {
      const status = await value<string>('SELECT m_delivery_status FROM js_message WHERE m_unique_id = $1 LIMIT 1', [String(data.message_id ?? '')]);
      return reply('200', 'Success', status);
    }
    case 'create_log':
      await apiLog({ adl_source: 2, adl_url: 'create_log', adl_value: limit(raw + JSON.stringify(input), 60000, ''), adl_user_id: input.userEmail ?? null, adl_api_key: req.headers.get('Api-Key') });
      return reply(1, 'Success');
    case 'sheet_activate': return sheetActivate(input);
    case 'sheet_status': return sheetStatus(input);
    case 'check_js_de': return new Response((await extractorKey(input)) ? 'OK' : 'Invalid Activation Key');
    case 'activate_js_de': return new Response(await extractorActivate(input));
    case 'deactivate_js_de': return new Response(await extractorDeactivate(input));
    default: return reply(0, 'Invalid Request');
  }
}

/**
 * Legacy waapi/client_api.php?at=send_wa — the template endpoint behind an
 * optional shared Api-Key header (its create_bot action never worked).
 */
export async function handleClientApi(req: Request): Promise<Response> {
  const key = config.clientApiKey;
  if (key !== '' && !safeEqual(key, req.headers.get('Api-Key') ?? '')) {
    return json({ status: '0', msg: 'Invalid credential', data: [] });
  }
  const { data } = await readInput(req);
  return new URL(req.url).searchParams.get('at') === 'send_wa' ? createMessage(data, 'template', true) : reply(0, 'Invalid Request');
}

async function createMessage(data: Record<string, any>, defaultType: string, templateEndpoint: boolean): Promise<Response> {
  const user = await authenticate(data);
  if (!user) return reply('202', '202 : Invalid Username', { id: '0', status: 'Invalid Username' });
  if (Number(user.u_wa_plan_status) !== 1) return reply('207', '207 : User WA Plan Expired', { id: '0', status: 'User WA Plan Expired' });

  let baseFile = '';
  if (data.base64File) {
    await mkdir(config.apiMediaPath, { recursive: true });
    baseFile = `${user.u_code}_${randomString(7)}_${phpDate('Y_m_d_h_i_s')}.json`;
    await writeFile(path.join(config.apiMediaPath, baseFile), JSON.stringify(data.base64File));
  }

  const type = data.message_type ? String(data.message_type) : defaultType;
  // The final type can still change inside messageFromApi (opt / type fields); the sender enforces the limit either way
  const finalType = templateEndpoint ? type : (data.type ? String(data.type) : String(data.opt ?? '') === '1' ? 'Authentication' : type);
  if (isLimitedType(finalType) && (await templateQuota(user.u_id)).remaining === 0) {
    return reply('208', '208 : Template Message Limit Reached', { id: '0', status: 'Template Message Limit Reached' });
  }
  const message = await messageFromApi(user, type, data, baseFile, templateEndpoint);
  if (Number(message.m_status) === 6) after(() => sendPending(message.m_id).catch((e) => console.error('[api] send failed', e)));

  return reply('200', 'Success', { id: templateEndpoint ? '0' : message.m_unique_id, status: 'Success' });
}

/** Active WhatsApp user by access key, or by username + password (CrmApi::fun_user_data). */
async function authenticate(data: Record<string, any>): Promise<Pick<UserRow, 'u_id' | 'u_code' | 'u_wa_plan_status'> | null> {
  const base = 'SELECT u_id, u_code, u_wa_plan_status, u_password FROM js_user WHERE u_dstatus = 0 AND u_status = 1 AND u_type = $1';
  if (data.access_key) {
    return one(`${base} AND u_access_code = $2 LIMIT 1`, [USER_TYPE.WHATSAPP, String(data.access_key)]);
  }
  if (!data.username || !data.password) return null;
  const user = await one<Pick<UserRow, 'u_id' | 'u_code' | 'u_wa_plan_status' | 'u_password'>>(`${base} AND u_username = $2 ORDER BY u_id LIMIT 1`, [USER_TYPE.WHATSAPP, String(data.username)]);
  return user && (await checkPassword(String(data.password), user.u_password)) ? user : null;
}

const isEmail = (v: unknown) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

async function sheetEmail(email: unknown) {
  return one<{ ue_id: number; ue_user_id: number }>('SELECT ue_id, ue_user_id FROM js_user_emails WHERE ue_dstatus = 0 AND ue_status = 1 AND ue_email_id = $1 LIMIT 1', [String(email ?? '')]);
}

async function sheetActivate(input: Record<string, any>): Promise<Response> {
  if (!isEmail(input.userEmail)) return reply(1001, 'Invalid Email ID');
  const email = await sheetEmail(input.userEmail);
  const sheetId = String(input.sheetId ?? '').trim();
  if (!email || sheetId === '') return reply(0, 'Invalid Email ID');
  if (await value('SELECT 1 FROM js_user_active_sheets WHERE us_status = 1 AND us_dstatus = 0 AND us_sheet_id = $1 LIMIT 1', [sheetId])) {
    return reply(1, 'Sheet Already Active');
  }
  await insert('js_user_active_sheets', {
    us_sheet_id: sheetId,
    us_user_id: email.ue_user_id,
    us_user_email_id: email.ue_id,
    us_sheet_type: parseInt(String(input.sheetType ?? '0'), 10) || 0,
    us_valid_till: now() + 365 * 86400,
    us_created_on: now(),
    us_status: 1,
  }, 'us_id');
  return reply(1, 'Sheet Successfully Activated');
}

async function sheetStatus(input: Record<string, any>): Promise<Response> {
  if (!isEmail(input.userEmail)) return reply(1001, 'Invalid Email ID');
  if (!(await sheetEmail(input.userEmail))) return reply(0, 'Invalid Email ID', { user_email: '' });
  const sheet = await one<{ ue_email_id: string }>(
    `SELECT e.ue_email_id FROM js_user_active_sheets s JOIN js_user_emails e ON e.ue_id = s.us_user_email_id
      WHERE s.us_status = 1 AND s.us_dstatus = 0 AND s.us_sheet_id = $1 LIMIT 1`, [String(input.sheetId ?? '')]);
  return sheet ? reply(1, 'Sheet is Active', { user_email: sheet.ue_email_id }) : reply(0, 'Sheet Not Active', { user_email: '' });
}

async function extractorKey(input: Record<string, any>) {
  return one<{ dek_id: number; dek_is_login: number }>(
    'SELECT dek_id, dek_is_login FROM js_user_data_extractor_keys WHERE dek_dstatus = 0 AND dek_status = 1 AND dek_key = $1 LIMIT 1', [String(input.key ?? '')]);
}

async function extractorActivate(input: Record<string, any>): Promise<string> {
  const key = await extractorKey(input);
  if (!key) return 'Invalid Activation Key';
  if (Number(key.dek_is_login) === 1) return 'Activation Key Already Login';
  await exec('UPDATE js_user_data_extractor_keys SET dek_is_login = 1, dek_last_login = $2, dek_login_counts = dek_login_counts + 1 WHERE dek_id = $1', [key.dek_id, now()]);
  return 'OK';
}

async function extractorDeactivate(input: Record<string, any>): Promise<string> {
  const key = await extractorKey(input);
  if (!key || Number(key.dek_is_login) !== 1) return 'Invalid Activation Key';
  await exec('UPDATE js_user_data_extractor_keys SET dek_is_login = 0, dek_last_login = 0 WHERE dek_id = $1', [key.dek_id]);
  return 'OK';
}

// ------------------------------------------------------------------ Shopify

function shopifyReply(status: string, msg: string, dataStatus = '') {
  return json({ data: { id: '0', status: dataStatus || msg }, msg, status });
}

/**
 * Shopify store webhooks (legacy waapi/shopify.php):
 *   new_order → order confirmation template, abandoned_cart → abandoned checkout template.
 * X-Shopify-Hmac-Sha256 is checked when SHOPIFY_WEBHOOK_SECRET is set.
 */
export async function handleShopify(req: Request, action: string): Promise<Response> {
  const body = await req.text();
  await apiLog({ adl_source: 3, adl_url: 'shopify_' + action, adl_value: limit(body, 60000, '') });

  const secret = config.shopify.webhookSecret;
  if (secret !== '') {
    const expected = createHmac('sha256', secret).update(body).digest('base64');
    if (!safeEqual(expected, req.headers.get('X-Shopify-Hmac-Sha256') ?? '')) return shopifyReply('401', 'Invalid signature');
  }

  const template = config.shopify.templates[action];
  const user = await one<{ u_id: number }>('SELECT u_id FROM js_user WHERE u_id = $1 AND u_dstatus = 0', [config.shopify.userId]);
  if (!template || !user) return shopifyReply('201', '201 : Error', 'Unable to Process');

  let order: Record<string, any> = {};
  try { order = JSON.parse(body) ?? {}; } catch { order = {}; }
  const mobile = String(order.phone ?? order.billing_address?.phone ?? '').replace(/\D/g, '').slice(-10);
  if (mobile === '') return shopifyReply('201', 'Phone number missing', 'Unable to Process');
  const name = String(order.billing_address?.name ?? '');
  const t = now();

  const row: Record<string, unknown> = {
    m_msg_type: 'template',
    m_title: phpDate('d-M-Y H:i:s', t),
    m_msg_template_name: template,
    m_contact_id: await contactId(user.u_id, mobile, name || null),
    m_mobile_no: mobile,
    m_user_id: user.u_id,
    m_status: 6,
    m_sheet_id: 'shopify',
    m_source: 2,
    m_is_incoming: 2,
    m_created_date: dayStart(t),
    m_created_on: t,
    m_in_process_on: t,
  };
  if (action === 'new_order') {
    row.m_msg_template_para = name + ',' + String(order.name ?? '').replace(/#/g, '');
  } else {
    row.m_msg_template_para = name;
    // The template's URL button holds the store domain; only "/path?query" is passed
    try {
      const u = new URL(String(order.order_status_url ?? order.abandoned_checkout_url ?? ''));
      row.m_button_url = u.pathname + (u.search || '');
    } catch {
      row.m_button_url = '';
    }
  }
  const message = await insertMessage(row);
  after(() => sendPending(message.m_id).catch((e) => console.error('[shopify] send failed', e)));
  return shopifyReply('200', 'Success', 'Success');
}

// ------------------------------------------------------------------ Meta webhook

/** Subscription handshake. */
export async function webhookVerify(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const token = q.get('hub_verify_token') ?? q.get('hub.verify_token') ?? '';
  const challenge = q.get('hub_challenge') ?? q.get('hub.challenge') ?? '';
  const configured = config.meta.webhookVerifyToken;
  const valid = configured === ''
    || safeEqual(configured, token)
    || (token !== '' && !!(await value('SELECT 1 FROM js_user WHERE u_access_code = $1 LIMIT 1', [token])));
  return valid ? new Response(challenge, { status: 200 }) : new Response('Invalid verify token', { status: 403 });
}

/**
 * Incoming messages + statuses. Always answers 200 (so Meta never disables the
 * subscription); forwarding to client URLs and auto-replies run after the response.
 */
export async function webhookReceive(req: Request): Promise<Response> {
  const body = await req.text();
  const secret = config.meta.appSecret;
  if (secret !== '') {
    const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    if (!safeEqual(expected, req.headers.get('X-Hub-Signature-256') ?? '')) return json({ status: '401', msg: 'Invalid signature' }, 401);
  }
  let payload: Record<string, any> = {};
  try { payload = JSON.parse(body) ?? {}; } catch { payload = {}; }
  if (payload.entry?.[0]?.changes?.[0]?.field === 'calls') {
    await apiLog({ adl_source: 3, adl_url: 'calls', adl_value: limit(body, 60000, '') });
  }
  try {
    await handleWebhook(payload, (task) => after(() => task().catch((e) => console.error('[webhook] deferred task failed', e))));
  } catch (e) {
    console.error('[webhook] processing failed', e);
  }
  return json({ status: '200', msg: '1' });
}

/** Instagram webhook and the spare newwebhook.php: log the payload and echo the challenge. */
export async function instagramWebhook(req: Request): Promise<Response> {
  const body = await req.text();
  if (body !== '') await apiLog({ adl_source: 3, adl_url: 'instagram', adl_value: limit(body, 60000, '') });
  const q = new URL(req.url).searchParams;
  return new Response(q.get('hub_challenge') ?? q.get('hub.challenge') ?? '', { status: 200 });
}
