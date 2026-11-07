import 'server-only';
import { config } from '../config';
import { value } from '../db';
import type { UserRow } from '../types';

/**
 * Thin wrapper over the WhatsApp Cloud (Graph) API (port of
 * Common::fun_wa_function_meta + fun_curl). Never throws: errors come back
 * as { error: { message } } like Meta's own error envelope.
 */

export type MetaResponse = Record<string, any> & { error?: { message?: string; code?: number; error_user_msg?: string } };

type WaUser = Pick<UserRow, 'u_wa_phone_id' | 'u_wa_b_id'>;

let tokenCache: { value: string; at: number } | null = null;
let appIdCache: string | null = null;

/**
 * The system-user token. The legacy app stored it in a master value row
 * (funGetWAKey); that row wins, WA_KEY is the fallback. Cached for 5 minutes.
 */
export async function metaToken(): Promise<string> {
  if (tokenCache && Date.now() - tokenCache.at < 300_000) return tokenCache.value;
  const id = config.meta.keyMasterId;
  const fromDb = id ? await value<string>('SELECT mv_value FROM js_master_value WHERE mv_id = $1', [id]).catch(() => null) : null;
  tokenCache = { value: fromDb || config.meta.key, at: Date.now() };
  return tokenCache.value;
}

async function call(method: 'GET' | 'POST', path: string, data: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<MetaResponse> {
  let target = path.startsWith('http') ? path : config.meta.apiUrl + path.replace(/^\/+/, '');
  const token = await metaToken();
  if (!token) {
    // Meta answers token-less calls with a misleading "object does not exist" error
    return { error: { message: `WhatsApp access token is not configured. Set WA_KEY in .env (or master value ${config.meta.keyMasterId}).` } };
  }
  const init: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (method === 'GET') {
    const qs = new URLSearchParams(Object.entries(data).map(([k, v]) => [k, String(v)])).toString();
    if (qs) target += (target.includes('?') ? '&' : '?') + qs;
  } else {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(data);
  }
  try {
    const res = await fetch(target, init);
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      return json && typeof json === 'object' ? json : { error: { message: `HTTP ${res.status}` } };
    } catch {
      return { error: { message: `HTTP ${res.status}` } };
    }
  } catch (e) {
    console.warn('[meta] API call failed', target, (e as Error).message);
    return { error: { message: (e as Error).message } };
  }
}

export const metaGet = (path: string, query: Record<string, unknown> = {}) => call('GET', path, query);
export const metaPost = (path: string, payload: Record<string, unknown> = {}) => call('POST', path, payload);

export function sendMessage(user: WaUser, payload: Record<string, unknown>): Promise<MetaResponse> {
  return metaPost(`${user.u_wa_phone_id}/messages`, payload);
}

/** Marketing Messages Lite API (legacy api_type 5, used when u_is_new_no = 1). */
export function sendMarketingMessage(user: WaUser, payload: Record<string, unknown>): Promise<MetaResponse> {
  return metaPost(`${user.u_wa_phone_id}/marketing_messages`, payload);
}

/** All templates of the WABA, following paging (max 20 pages of 250). */
export async function fetchTemplates(user: WaUser): Promise<Record<string, any>[]> {
  const all: Record<string, any>[] = [];
  let next: string | null = `${user.u_wa_b_id}/message_templates`;
  let query: Record<string, unknown> = { limit: 250 };
  for (let page = 0; page < 20 && next; page++) {
    const res = await metaGet(next, query);
    all.push(...(res.data ?? []));
    next = res.paging?.next ?? null;
    query = {};
  }
  return all;
}

export interface WaFlow { id: string; name: string; status: string }

/** WhatsApp Flows of the WABA (for Flow buttons on new templates). Null when WhatsApp can't be reached. */
export async function listFlows(user: WaUser): Promise<WaFlow[] | null> {
  const res = await call('GET', `${user.u_wa_b_id}/flows`, { fields: 'id,name,status', limit: 200 }, 8_000);
  if (res.error || !Array.isArray(res.data)) return null;
  return res.data
    .filter((f: any) => f?.id && f.status !== 'DEPRECATED')
    .map((f: any) => ({ id: String(f.id), name: String(f.name ?? f.id), status: String(f.status ?? '') }));
}

/** Submit a new template for Meta review. */
export function createTemplate(user: WaUser, payload: Record<string, unknown>): Promise<MetaResponse> {
  return metaPost(`${user.u_wa_b_id}/message_templates`, payload);
}

/** App that owns the token: FB_APP_ID, or looked up from the token itself. */
async function appId(): Promise<string | null> {
  if (config.meta.fbAppId) return config.meta.fbAppId;
  if (!appIdCache) appIdCache = (await metaGet('app')).id ?? null;
  return appIdCache;
}

/**
 * Upload a sample header file through the Resumable Upload API and return
 * the handle that templates expect in example.header_handle.
 */
export async function uploadSample(bytes: Buffer, mime: string, name: string): Promise<string | null> {
  const app = await appId();
  if (!app) return null;
  const qs = new URLSearchParams({ file_name: name, file_length: String(bytes.length), file_type: mime });
  const session = await metaPost(`${app}/uploads?${qs}`, {});
  if (!session.id) {
    console.warn('[meta] sample upload session failed', session);
    return null;
  }
  try {
    const res = await fetch(config.meta.apiUrl + session.id, {
      method: 'POST',
      headers: { Authorization: `OAuth ${await metaToken()}`, file_offset: '0', 'Content-Type': mime },
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(120_000),
    });
    const json = (await res.json().catch(() => ({}))) as { h?: string };
    return json.h ?? null;
  } catch (e) {
    console.warn('[meta] sample upload failed', (e as Error).message);
    return null;
  }
}

export function mediaInfo(user: WaUser, mediaId: string): Promise<MetaResponse> {
  return metaGet(mediaId, { phone_number_id: user.u_wa_phone_id });
}

/** Download a media binary (Meta media URLs require the bearer token). */
export async function downloadMedia(mediaUrl: string): Promise<{ body: Buffer; type: string } | null> {
  try {
    const res = await fetch(mediaUrl, { headers: { Authorization: `Bearer ${await metaToken()}` }, signal: AbortSignal.timeout(400_000) });
    if (!res.ok) return null;
    return { body: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') ?? 'application/octet-stream' };
  } catch (e) {
    console.warn('[meta] media download failed', mediaUrl, (e as Error).message);
    return null;
  }
}

export function registerNumber(user: WaUser): Promise<MetaResponse> {
  return metaPost(`${user.u_wa_phone_id}/register`, { messaging_product: 'whatsapp', pin: config.meta.registerPin });
}

export function subscribeApp(user: WaUser): Promise<MetaResponse> {
  return metaPost(`${user.u_wa_b_id}/subscribed_apps`, {});
}
