/**
 * Graph API client for Meta Lead Ads (no server-only import, so tests can use it with a fake fetch).
 * - GET / POST helpers; nested objects and arrays are JSON-encoded.
 * - The token is sent in the Authorization header, never in the URL, and never appears in errors or logs.
 * - Rate-limit / transient errors (codes 1, 2, 4, 17, 32, 613, HTTP 5xx, network) are retried with exponential backoff.
 */

export const RETRYABLE_CODES = [1, 2, 4, 17, 32, 613] as const;

export class MetaError extends Error {
  constructor(message: string, public code = 0, public subcode = 0, public status = 0, public userMessage = '') {
    super(message);
    this.name = 'MetaError';
  }
  get retryable(): boolean {
    return (RETRYABLE_CODES as readonly number[]).includes(this.code) || this.status >= 500 || this.status === 0;
  }
  /** "message (code 100/1487390)" for screens and logs. */
  describe(): string {
    const extra = this.userMessage && !this.message.includes(this.userMessage) ? ` ${this.userMessage}` : '';
    return `${this.message}${extra}${this.code ? ` (code ${this.code}${this.subcode ? `/${this.subcode}` : ''})` : ''}`;
  }
}

export type Params = Record<string, unknown>;

export interface GraphOptions {
  baseUrl: string;                       // e.g. https://graph.facebook.com/v25.0/
  token: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  retries?: number;                      // extra attempts after the first (default 3)
  timeoutMs?: number;
}

export interface Graph {
  get<T = Record<string, any>>(path: string, params?: Params, token?: string): Promise<T>;
  post<T = Record<string, any>>(path: string, params?: Params, token?: string): Promise<T>;
}

/** Form / query encoding: strings and numbers as they are, everything else (objects, arrays, booleans) as JSON. */
export function encodeParams(params: Params): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    out.set(k, typeof v === 'string' || typeof v === 'number' ? String(v) : JSON.stringify(v));
  }
  return out;
}

export function createGraph(opts: GraphOptions): Graph {
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const retries = opts.retries ?? 3;
  const base = opts.baseUrl.replace(/\/+$/, '') + '/';

  async function call<T>(method: 'GET' | 'POST', path: string, params: Params, token: string): Promise<T> {
    if (!token) throw new MetaError('No Meta access token is configured (META_SYSTEM_USER_TOKEN).');
    const body = encodeParams(params);
    const url = `${base}${path.replace(/^\/+/, '')}${method === 'GET' && [...body].length ? `?${body}` : ''}`;
    for (let attempt = 0; ; attempt++) {
      let err: MetaError;
      try {
        const res = await doFetch(url, {
          method,
          headers: { Authorization: `Bearer ${token}`, ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
          body: method === 'POST' ? body : undefined,
          signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
        });
        const json = (await res.json().catch(() => ({}))) as Record<string, any>;
        if (res.ok && !json.error) return json as T;
        const e = json.error ?? {};
        err = new MetaError(String(e.message ?? `HTTP ${res.status}`), Number(e.code) || 0, Number(e.error_subcode) || 0, res.status,
          String(e.error_user_msg ?? e.error_user_title ?? ''));
      } catch (e) {
        err = e instanceof MetaError ? e : new MetaError(`Could not reach Meta: ${(e as Error).name === 'TimeoutError' ? 'timed out' : (e as Error).message}`);
      }
      if (!err.retryable || attempt >= retries) throw err;
      await sleep(Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 250));
    }
  }

  return {
    get: (path, params = {}, token = opts.token) => call('GET', path, params, token),
    post: (path, params = {}, token = opts.token) => call('POST', path, params, token),
  };
}

/** GET a list and follow paging.cursors.after (up to `max` items). */
export async function graphList<T>(graph: Graph, path: string, params: Params, max = 5000, token?: string): Promise<T[]> {
  const out: T[] = [];
  let after = '';
  for (;;) {
    const res = await graph.get<{ data?: T[]; paging?: { cursors?: { after?: string }; next?: string } }>(path, { ...params, ...(after ? { after } : {}) }, token);
    out.push(...(res.data ?? []));
    after = res.paging?.next ? String(res.paging.cursors?.after ?? '') : '';
    if (!after || out.length >= max) return out.slice(0, max);
  }
}

// ------------------------------------------------------------------ the calls the spec names

export const LEAD_FIELDS = 'id,created_time,field_data,ad_id,ad_name,adset_id,campaign_id,campaign_name,form_id,platform,is_organic';

export interface MetaLead {
  id: string; created_time?: string; field_data?: { name: string; values?: unknown[] }[];
  ad_id?: string; ad_name?: string; adset_id?: string; campaign_id?: string; campaign_name?: string; form_id?: string;
  platform?: string; is_organic?: boolean;
}

export async function getPageToken(graph: Graph, pageId: string): Promise<string> {
  const res = await graph.get<{ access_token?: string }>(pageId, { fields: 'access_token' });
  if (!res.access_token) throw new MetaError(`No Page access token for Page ${pageId}: is the System User assigned to this Page?`);
  return res.access_token;
}

/** Upload image bytes to the ad account; returns the image hash. */
export async function uploadImage(graph: Graph, adAccountId: string, file: { bytes: Uint8Array; name: string }): Promise<string> {
  const res = await graph.post<{ images?: Record<string, { hash?: string }> }>(`${adAccountId}/adimages`, {
    bytes: Buffer.from(file.bytes).toString('base64'), name: file.name,
  });
  const hash = Object.values(res.images ?? {})[0]?.hash;
  if (!hash) throw new MetaError('Meta did not return an image hash for the creative image.');
  return hash;
}

export function fetchLead(graph: Graph, leadgenId: string, token?: string): Promise<MetaLead> {
  return graph.get<MetaLead>(leadgenId, { fields: LEAD_FIELDS }, token);
}
