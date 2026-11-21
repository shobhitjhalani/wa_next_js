import 'server-only';
import { query, value } from '@/lib/db';
import { metaGet } from '@/lib/services/meta';
import { TEMPLATE_TYPES } from '@/lib/services/reports';
import { now } from '@/lib/time';

/**
 * Meta's daily messaging limit of a WhatsApp number: how many different people the business may start a
 * conversation with (template messages) in a rolling 24 hours, plus the number's quality rating.
 * The limit comes from Meta (cached 10 minutes per number); "used" is counted from our own sent messages.
 */

export interface MetaLimit {
  /** e.g. 1000; null = unlimited */
  limit: number | null;
  /** Meta's tier name, e.g. TIER_1K */
  tier: string;
  /** GREEN / YELLOW / RED / UNKNOWN */
  quality: string;
  /** Different people sent a template in the last 24 hours (all accounts on this WABA) */
  used: number;
  /** Meta could not be asked (token / network); limit and quality unknown */
  error?: string;
}

/** TIER_250 → 250, TIER_2K → 2000, TIER_100K → 100000, TIER_UNLIMITED → null; undefined when not a tier. */
export function tierLimit(tier: string | null | undefined): number | null | undefined {
  const t = String(tier ?? '').trim().toUpperCase();
  if (t === 'TIER_UNLIMITED' || t === 'UNLIMITED') return null;
  const m = /^TIER_(\d+)(K|M)?$/.exec(t);
  if (!m) return undefined;
  return Number(m[1]) * (m[2] === 'M' ? 1_000_000 : m[2] === 'K' ? 1000 : 1);
}

type Fetched = { tier: string; quality: string; error?: string };
const cache = new Map<string, { at: number; data: Fetched }>();
const TTL = 600;

const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T) =>
  Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);

async function fetchFromMeta(phoneId: string, wabaId: string): Promise<Fetched> {
  const timeout = { error: { message: 'Meta did not answer in time' } } as Record<string, any>;
  // Since late 2025 the limit is set per business portfolio (WABA field); older numbers still report it on the number
  const [phone, waba] = await Promise.all([
    withTimeout(metaGet(phoneId, { fields: 'quality_rating,messaging_limit_tier' }), 8000, timeout),
    wabaId ? withTimeout(metaGet(wabaId, { fields: 'whatsapp_business_manager_messaging_limit' }), 8000, timeout) : Promise.resolve({} as Record<string, any>),
  ]);
  // An unknown field fails the whole call: ask for the quality rating alone
  const phoneData = phone.error ? await withTimeout(metaGet(phoneId, { fields: 'quality_rating' }), 8000, timeout) : phone;
  const tiers = [waba.whatsapp_business_manager_messaging_limit, phone.messaging_limit_tier].map((t) => String(t ?? ''));
  const tier = tiers.find((t) => tierLimit(t) !== undefined) ?? '';
  return {
    tier,
    quality: String(phoneData.quality_rating ?? '').toUpperCase(),
    error: !tier && phoneData.error ? String(phoneData.error.message ?? 'Meta error') : undefined,
  };
}

/** The account's Meta messaging limit and how much of it was used in the last 24 hours. */
export async function metaLimit(user: { u_id: number; u_wa_phone_id?: string | null; u_wa_b_id?: string | null }): Promise<MetaLimit | null> {
  const phoneId = String(user.u_wa_phone_id ?? '').trim();
  const wabaId = String(user.u_wa_b_id ?? '').trim();
  if (!phoneId) return null;

  const key = `${phoneId}|${wabaId}`;
  let hit = cache.get(key);
  if (!hit || now() - hit.at > TTL) {
    const data = await fetchFromMeta(phoneId, wabaId);
    // Errors are retried after a minute, not ten
    hit = { at: data.error ? now() - TTL + 60 : now(), data };
    cache.set(key, hit);
  }

  // Every account using the same WABA shares the limit
  const ids = wabaId
    ? (await query<{ u_id: number }>('SELECT u_id FROM js_user WHERE u_wa_b_id = $1', [wabaId])).map((r) => r.u_id)
    : [];
  if (!ids.includes(user.u_id)) ids.push(user.u_id);
  const used = await value<number>(
    `SELECT COUNT(DISTINCT m_mobile_no)::int FROM js_message
      WHERE m_user_id = ANY($1::int[]) AND m_status = 3 AND m_is_incoming = 2 AND m_in_process_on >= $2
        AND m_dstatus = 0 AND COALESCE(m_message_id, '') <> '' AND m_msg_type = ANY($3::text[])
        AND COALESCE(m_delivery_status, '') <> 'failed'`,
    [ids, now() - 86400, TEMPLATE_TYPES],
  );

  const limit = tierLimit(hit.data.tier);
  return { limit: limit === undefined ? null : limit, tier: hit.data.tier, quality: hit.data.quality, used: used ?? 0, error: hit.data.error };
}
