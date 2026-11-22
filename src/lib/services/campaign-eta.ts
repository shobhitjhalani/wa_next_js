import 'server-only';
import { config } from '../config';
import { query } from '../db';
import { now } from '../time';
import { quotaOf } from './template-limit';
import { expirySeconds } from './sender';

/**
 * Tentative finish time of campaigns still sending, from the sending limit:
 * the queue worker sends up to WA_SEND_BATCH messages per account per minute,
 * only between WA_SEND_START_HOUR and WA_SEND_END_HOUR, oldest message first.
 * A campaign therefore waits for the account's earlier queued messages too.
 */

export interface CampaignEta {
  /** Messages that go out before this campaign's last one (its own pending + earlier queue) */
  ahead: number;
  /** Unix seconds when the last message is expected to go out */
  finishAt: number;
  /** Some messages would be older than the 24-hour limit by then and will not be sent */
  expires: boolean;
  /** Hours after which unsent messages of this account expire. */
  expiryHours: number;
  /** Template messages left on the account's limit, when it is smaller than what is queued */
  quotaLeft: number | null;
}

export const sendRatePerMinute = () => Math.max(1, config.sendBatch);

/** '7 AM–11 PM' style label of the sending window. */
export function sendWindowText(): string {
  const h = (n: number) => `${n % 12 || 12} ${n < 12 || n === 24 ? 'AM' : 'PM'}`;
  return `${h(config.sendStartHour)}–${h(config.sendEndHour)}`;
}

function minuteOfDay(t: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: config.timezone }).formatToParts(new Date(t * 1000));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return get('hour') * 60 + get('minute');
}

/** When `count` messages are out, sending `rate` a minute inside the daily window, starting at `from`. */
export function finishTime(count: number, from: number = now(), rate: number = sendRatePerMinute()): number {
  const start = config.sendStartHour * 60;
  const end = config.sendEndHour * 60;
  if (count <= 0) return from;
  if (end <= start) return from + Math.ceil(count / rate) * 60;
  let left = Math.ceil(count / rate) + 1; // the worker runs once a minute
  let t = from;
  for (let guard = 0; guard < 400; guard++) {
    const m = minuteOfDay(t);
    if (m < start) { t += (start - m) * 60; continue; }
    if (m >= end) { t += (1440 - m + start) * 60; continue; }
    const avail = end - m;
    if (left <= avail) return t + left * 60;
    left -= avail;
    t += (avail + 1440 - end + start) * 60;
  }
  return t;
}

/** "25 min", "3 h 10 min", "2 days 4 h" */
export function durationText(seconds: number): string {
  const min = Math.max(1, Math.round(seconds / 60));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h${min % 60 ? ` ${min % 60} min` : ''}`;
  const d = Math.floor(h / 24);
  return `${d} day${d > 1 ? 's' : ''}${h % 24 ? ` ${h % 24} h` : ''}`;
}

/** ETA per campaign id for the given campaigns of one account that still have queued messages. */
export async function campaignEtas(
  user: { u_id: number; u_msg_limit: number | null; u_msg_used: number | null; u_msg_expiry_hours?: number | null },
  campaigns: { uc_id: number; uc_started_at: number }[],
): Promise<Map<number, CampaignEta>> {
  const out = new Map<number, CampaignEta>();
  if (!campaigns.length) return out;
  const rows = await query<{ id: number; ahead: number; oldest: number }>(
    `WITH last AS (
       SELECT m_campaign_id AS id, MAX(m_id) AS mx, MIN(m_created_on) AS oldest FROM js_message
        WHERE m_user_id = $1 AND m_campaign_id = ANY($2::int[]) AND m_is_incoming = 2 AND m_status IN (1, 6) AND m_dstatus = 0
        GROUP BY m_campaign_id)
     SELECT l.id, l.oldest::int AS oldest,
            (SELECT COUNT(*) FROM js_message m WHERE m.m_user_id = $1 AND m.m_is_incoming = 2 AND m.m_status IN (1, 6)
                AND m.m_dstatus = 0 AND m.m_id <= l.mx)::int AS ahead
       FROM last l`,
    [user.u_id, campaigns.map((c) => c.uc_id)],
  );
  const quota = quotaOf(user);
  const t = now();
  for (const r of rows) {
    const finishAt = finishTime(r.ahead, t);
    out.set(r.id, {
      ahead: r.ahead,
      finishAt,
      expires: finishAt > Number(r.oldest) + expirySeconds(user.u_msg_expiry_hours),
      expiryHours: Math.round(expirySeconds(user.u_msg_expiry_hours) / 3600),
      quotaLeft: quota.remaining !== null && quota.remaining < r.ahead ? quota.remaining : null,
    });
  }
  return out;
}
