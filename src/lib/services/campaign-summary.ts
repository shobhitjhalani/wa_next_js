import 'server-only';
import { like, query } from '../db';
import { campaignIsTracked, campaignSendAt, campaignTitle } from '../format';
import { sp } from '../http';
import { monthStart, now, parseDateRange, phpDate } from '../time';
import { CAMPAIGN, type CampaignRow } from '../types';

/**
 * Campaign Summary report (user /reports_templates and admin /wamaster/reports/templates):
 * one row per campaign with its messages by status.
 *
 *   Send       accepted by WhatsApp, no delivery receipt yet
 *   Delivered  delivered, not read
 *   Read       read
 *   Failed     accepted, then reported failed by WhatsApp
 *   Error      rejected by the API (no WhatsApp message id)
 *   In Que     queued / being sent
 *   Total      Send + Delivered + Read
 *   Total Data every message of the campaign (all of the above)
 *
 * Each recipient is counted once: skipped (opted out / cancelled) and the
 * originals of resent messages (status 8) are left out.
 */

export const STATUS_COLUMNS = [
  ['sent', 'Send'], ['delivered', 'Delivered'], ['read', 'Read'], ['failed', 'Failed'], ['error', 'Error'], ['queue', 'In Que'],
] as const;
export type StatusKey = (typeof STATUS_COLUMNS)[number][0];
export type Counts = Record<StatusKey, number> & { total: number; all: number };

export interface SummaryRow {
  id: number;
  userId: number;
  username: string;
  date: number;
  name: string;
  template: string;
  /** null: sent before messages were linked to campaigns, only the recipient count is known */
  counts: Counts | null;
  recipients: number;
}

export interface SummaryFilter { date: string; q: string }

export function readSummaryFilter(params: Record<string, string | string[] | undefined> | URLSearchParams): SummaryFilter {
  const present = params instanceof URLSearchParams ? params.has('wa_date') : params.wa_date !== undefined;
  // Default: this month so far
  return { date: present ? sp(params, 'wa_date') : `${phpDate('d-m-Y', monthStart())} to ${phpDate('d-m-Y', now())}`, q: sp(params, 'q') };
}

const empty = (): Counts => ({ sent: 0, delivered: 0, read: 0, failed: 0, error: 0, queue: 0, total: 0, all: 0 });

/** Whose campaigns: one user (user panel), or for admins optionally a user and / or a corporate account's users. */
export interface SummaryScope { userId?: number | null; parentId?: number | null }

export async function campaignSummary(scope: SummaryScope, f: SummaryFilter): Promise<{ rows: SummaryRow[]; totals: Counts; untracked: number }> {
  const args: unknown[] = [CAMPAIGN.SCHEDULED];
  let where = 'c.uc_status <> $1';
  if (scope.userId) { args.push(scope.userId); where += ` AND c.uc_user_id = $${args.length}`; }
  if (scope.parentId) { args.push(scope.parentId); where += ` AND u.u_parent_id = $${args.length}`; }
  if (f.q !== '') { args.push('%' + like(f.q) + '%'); where += ` AND (c.uc_name ILIKE $${args.length} OR c.uc_template ILIKE $${args.length})`; }
  const campaigns = await query<CampaignRow & { u_username: string | null }>(
    `SELECT c.*, u.u_username FROM js_user_campaign c JOIN js_user u ON u.u_id = c.uc_user_id WHERE ${where} ORDER BY c.uc_id DESC`, args);

  // The send date of old campaigns is their creation time (a local timestamp), so the range is applied here
  const range = parseDateRange(f.date);
  const inRange = campaigns
    .map((c) => ({ c, date: campaignSendAt(c) }))
    .filter(({ date }) => !range || (date >= range[0] && date < range[1]))
    .sort((a, b) => b.date - a.date || b.c.uc_id - a.c.uc_id);

  const tracked = inRange.filter(({ c }) => campaignIsTracked(c)).map(({ c }) => c.uc_id);
  const stats = tracked.length
    ? await query<{ id: number } & Omit<Counts, 'total' | 'all'>>(
      `SELECT m_campaign_id AS id,
              COUNT(*) FILTER (WHERE m_status = 3 AND COALESCE(m_message_id, '') <> '' AND COALESCE(m_delivery_status, '') NOT IN ('delivered', 'read', 'failed'))::int AS sent,
              COUNT(*) FILTER (WHERE m_status = 3 AND COALESCE(m_message_id, '') <> '' AND m_delivery_status = 'delivered')::int AS delivered,
              COUNT(*) FILTER (WHERE m_status = 3 AND COALESCE(m_message_id, '') <> '' AND m_delivery_status = 'read')::int AS read,
              COUNT(*) FILTER (WHERE m_status = 3 AND COALESCE(m_message_id, '') <> '' AND m_delivery_status = 'failed')::int AS failed,
              COUNT(*) FILTER (WHERE m_status = 3 AND COALESCE(m_message_id, '') = '')::int AS error,
              COUNT(*) FILTER (WHERE m_status IN (1, 6))::int AS queue
         FROM js_message WHERE m_campaign_id = ANY($1::int[]) AND m_dstatus = 0
        GROUP BY m_campaign_id`,
      [tracked],
    )
    : [];
  const byId = new Map(stats.map((s) => [s.id, s]));

  const totals = empty();
  let untracked = 0;
  const rows = inRange.map(({ c, date }): SummaryRow => {
    const recipients = Number(c.uc_total_contacts) || 0;
    const who = { userId: c.uc_user_id, username: String(c.u_username ?? c.uc_user_id) };
    if (!campaignIsTracked(c)) {
      untracked++;
      totals.all += recipients;
      return { id: c.uc_id, ...who, date, name: campaignTitle(c), template: c.uc_template ?? '', counts: null, recipients };
    }
    const s = byId.get(c.uc_id);
    const counts = empty();
    for (const [key] of STATUS_COLUMNS) counts[key] = Number(s?.[key] ?? 0);
    counts.total = counts.sent + counts.delivered + counts.read;
    counts.all = counts.total + counts.failed + counts.error + counts.queue;
    for (const k of Object.keys(totals) as (keyof Counts)[]) totals[k] += counts[k];
    return { id: c.uc_id, ...who, date, name: campaignTitle(c), template: c.uc_template ?? '', counts, recipients };
  });
  return { rows, totals, untracked };
}
