// Port of Common::fun_wa_function_meta() / fun_wa_function_meta_template() / fun_curl().
import { db } from "@/lib/db";
import { config } from "@/lib/config";

export const enum MetaApi {
  SendMessage = 1,
  Media = 2,
  DownloadMedia = 3,
  Templates = 4,
  MarketingMessage = 5,
  Register = 6,
  SubscribeWaba = 7,
}

export type MetaUser = {
  u_id: number;
  u_parent_id: number;
  u_wa_phone_id: string | null;
  u_wa_b_id: string | null;
};

export type MetaResponse = {
  messages?: { id: string }[];
  error?: { message?: string; code?: number; error_subcode?: number; error_data?: unknown };
  [key: string]: unknown;
};

// Access token is stored in js_master_value row 56203 (Common::funGetWAKey), not in config.
const WA_KEY_MASTER_VALUE_ID = 56203;
let cachedKey: { value: string; at: number } | null = null;

export async function getWaKey(): Promise<string> {
  if (cachedKey && Date.now() - cachedKey.at < 60_000) return cachedKey.value;
  const row = await db.js_master_value.findUnique({
    where: { mv_id: WA_KEY_MASTER_VALUE_ID },
    select: { mv_value: true },
  });
  const value = row?.mv_value || config.wa.key;
  cachedKey = { value, at: Date.now() };
  return value;
}

function endpoint(api: MetaApi, user: MetaUser, extra: { mediaId?: string; mediaUrl?: string }): string {
  const phone = user.u_wa_phone_id ?? "";
  const business = user.u_wa_b_id ?? "";
  switch (api) {
    case MetaApi.SendMessage:
      return `${config.wa.apiUrl}${phone}/messages`;
    case MetaApi.Media:
      return `${config.wa.apiUrl}${extra.mediaId}?phone_number_id=${phone}`;
    case MetaApi.DownloadMedia:
      return extra.mediaUrl ?? "";
    case MetaApi.Templates:
      return `${config.wa.apiUrl}${business}/message_templates`;
    case MetaApi.MarketingMessage:
      return `${config.wa.apiUrl}${phone}/marketing_messages`;
    case MetaApi.Register:
      return `${config.wa.apiUrl}${phone}/register`;
    case MetaApi.SubscribeWaba:
      return `${config.wa.apiUrl}${business}/subscribed_apps`;
  }
}

/**
 * Calls the WhatsApp Cloud API on behalf of a user. Like the PHP version, users
 * without a parent account (u_parent_id = 0) cannot use the API and get null.
 */
export async function callMeta(
  api: MetaApi,
  user: MetaUser,
  body?: unknown,
  opts: { method?: "GET" | "POST" | "DELETE"; query?: Record<string, string>; mediaId?: string; mediaUrl?: string } = {},
): Promise<MetaResponse | null> {
  if (!(user.u_id > 0) || !(user.u_parent_id > 0)) return null;

  let url = endpoint(api, user, opts);
  if (!url) return null;
  if (opts.query && Object.keys(opts.query).length) {
    url += (url.includes("?") ? "&" : "?") + new URLSearchParams(opts.query).toString();
  }

  const method = opts.method ?? (body === undefined ? "GET" : "POST");
  const key = await getWaKey();
  try {
    const res = await fetch(url, {
      method,
      headers: {
        "cache-control": "no-cache",
        "content-type": "application/json",
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    try {
      return JSON.parse(text) as MetaResponse;
    } catch {
      return { error: { message: `Non-JSON response (${res.status}): ${text.slice(0, 200)}` } };
    }
  } catch (e) {
    return { error: { message: `Request failed: ${(e as Error).message}` } };
  }
}

/** POST/GET JSON to a non-Meta helper service (Common::fun_image_curl). */
export async function jsonRequest(url: string, data?: unknown, method: "GET" | "POST" = "POST") {
  try {
    const res = await fetch(url, {
      method,
      headers: { "cache-control": "no-cache", "content-type": "application/json" },
      body: method === "POST" ? JSON.stringify(data ?? {}) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    return (await res.json().catch(() => null)) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}
