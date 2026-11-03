// Shared plumbing for the partner APIs ported from waapi/*.php: request parsing the way
// PHP saw it ($_REQUEST / $_POST / php://input), CORS headers, user auth (fun_user_data)
// and the base64 attachment file.
import { randomInt, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { verifyPassword } from "@/lib/password";
import { waapiMediaRoot } from "@/lib/wa/media";
import { contactFor } from "@/lib/wa/webhook-store";

export type LegacyRequest = {
  /** $_REQUEST: query string, overridden by form POST fields (PHP request_order "GP"). */
  request: Record<string, string>;
  /** $_POST (form-encoded / multipart fields). */
  post: Record<string, string>;
  /** json_decode(php://input) — null when the body is not JSON. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- arbitrary partner JSON (PHP arrays)
  json: Record<string, any> | null;
  raw: string;
  headers: Headers;
};

/**
 * The .htaccess rules put path segments into the query string. Route handlers see the
 * original URL after a Next.js rewrite, so the same rules are applied here.
 */
const PATH_RULES: [RegExp, (m: RegExpMatchArray) => Record<string, string>][] = [
  [/^\/api\/secure\/v1\/([^/]+)\/?$/, (m) => ({ at: m[1] })],
  [/^\/wa\/secure\/v1\/([^/]+)-([^/]+)\/?$/, (m) => ({ at: m[1], uk: m[2] })], // greedy, like Apache
  [/^\/api\/shopify\/v1\/([^/]+)\/?$/, (m) => ({ at: m[1] })],
];

function pathParams(pathname: string): Record<string, string> {
  for (const [re, map] of PATH_RULES) {
    const m = decodeURIComponent(pathname).match(re);
    if (m) return map(m);
  }
  return {};
}

export async function readLegacyRequest(req: Request): Promise<LegacyRequest> {
  const url = new URL(req.url);
  const query = { ...Object.fromEntries(url.searchParams), ...pathParams(url.pathname) };
  const type = req.headers.get("content-type") ?? "";
  const post: Record<string, string> = {};
  let raw = "";
  if (req.method !== "GET" && req.method !== "HEAD") {
    if (type.includes("multipart/form-data")) {
      const form = await req.formData().catch(() => null);
      form?.forEach((v, k) => typeof v === "string" && (post[k] = v));
    } else {
      raw = await req.text();
      if (type.includes("application/x-www-form-urlencoded")) {
        new URLSearchParams(raw).forEach((v, k) => (post[k] = v));
      }
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- arbitrary partner JSON (PHP arrays)
  let json: Record<string, any> | null = null;
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    json = parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    json = null;
  }
  return { request: { ...query, ...post }, post, json, raw, headers: req.headers };
}

/** Same CORS behaviour as the PHP headers: reflect the Origin, allow credentials. */
export function corsHeaders(req: Request): Record<string, string> {
  const h: Record<string, string> = {};
  const origin = req.headers.get("origin");
  if (origin) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Credentials"] = "true";
    h["Access-Control-Max-Age"] = "86400";
  }
  if (req.method === "OPTIONS") {
    if (req.headers.get("access-control-request-method")) h["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    const reqHeaders = req.headers.get("access-control-request-headers");
    if (reqHeaders) h["Access-Control-Allow-Headers"] = reqHeaders;
  }
  return h;
}

export const jsonResponse = (req: Request, body: unknown) =>
  NextResponse.json(body, { headers: corsHeaders(req) });

export const textResponse = (req: Request, body: string) =>
  new NextResponse(body, { headers: { ...corsHeaders(req), "content-type": "text/html; charset=UTF-8" } });

/** PHP's loose `$x == '1'` for values that arrive as 1, "1" or true. */
export const isOne = (v: unknown) => v === true || String(v ?? "") === "1";

/** PHP str_replace of quotes into entities, applied to every saved value. */
export const entities = (v: unknown): string | null =>
  v == null ? null : String(v).replace(/'/g, "&#39;").replace(/"/g, "&#34;");

export type ApiUser = {
  id: number;
  username: string;
  api_url: string;
  wa_plan_status: number;
  /** u_code (PHP called it access_code). */
  access_code: string;
  /** u_access_code (PHP called it user_key). */
  user_key: string;
};

/**
 * Port of CrmApi::fun_user_data(): authenticates with the access key when given,
 * otherwise with username + password. Accepts legacy and bcrypt password hashes.
 */
export async function apiUser(username?: unknown, password?: unknown, key?: unknown): Promise<ApiUser | null> {
  const base = { u_status: 1, u_type: 2, u_dstatus: 0 };
  let user = null;
  if (key != null && String(key) !== "") {
    user = await db.js_user.findFirst({ where: { ...base, u_access_code: String(key) } });
  } else if (username != null && String(username) !== "") {
    const candidates = await db.js_user.findMany({
      where: { ...base, u_username: { equals: String(username), mode: "insensitive" } },
    });
    for (const c of candidates) {
      if ((await verifyPassword(String(password ?? ""), c.u_password)).ok) {
        user = c;
        break;
      }
    }
  }
  if (!user) return null;
  return {
    id: user.u_id,
    username: (user.u_username ?? "").toLowerCase(),
    api_url: user.u_api_url ?? "",
    wa_plan_status: user.u_wa_plan_status,
    access_code: user.u_code ?? "",
    user_key: user.u_access_code ?? "",
  };
}

/** fun_contact_list() for API input: only a single mobile number gets a contact (PHP's query failed otherwise). */
export async function apiContact(userId: number, mobileNo: string, name?: string | null): Promise<number> {
  if (!/^\+?\d{1,15}$/.test(mobileNo)) return 0;
  return contactFor(userId, mobileNo, name);
}

/** IST date parts formatted like PHP date(). */
function phpDateParts(d = new Date()) {
  const p: Record<"year" | "month" | "day" | "hour" | "minute" | "second", string> = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(d).map((x) => [x.type, x.value]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", string>;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const h12 = String(((Number(p.hour) + 11) % 12) + 1).padStart(2, "0");
  return { ...p, M: months[Number(p.month) - 1], h12 };
}

/** PHP date('d-M-Y H:i:s'), e.g. 02-Nov-2026 23:15:00 — the m_title of API messages. */
export function phpTitleDate(d = new Date()) {
  const p = phpDateParts(d);
  return `${p.day}-${p.M}-${p.year} ${p.hour}:${p.minute}:${p.second}`;
}

/**
 * Saves the request's base64File list as waapi/media/<name>.json, read later by the sender.
 * withRandom: <u_code>_<7 digits>_<Y_m_d_h_i_s>.json (fun_generate_unique_no), otherwise
 * <u_code>_<Y_m_d_h_i_s>.json as create_wa_test / create_wa_reply did.
 */
export async function saveBase64File(accessCode: string, base64File: unknown, withRandom: boolean): Promise<string> {
  const p = phpDateParts();
  const stamp = `${p.year}_${p.month}_${p.day}_${p.h12}_${p.minute}_${p.second}`;
  const digits = withRandom ? Array.from({ length: 7 }, () => randomInt(10)).join("") + "_" : "";
  const fileName = `${accessCode}_${digits}${stamp}.json`.replace(/ /g, "_");
  const safe = path.basename(fileName);
  await mkdir(waapiMediaRoot(), { recursive: true });
  await writeFile(path.join(waapiMediaRoot(), safe), JSON.stringify(base64File));
  return safe;
}

export const uuid = () => randomUUID();
