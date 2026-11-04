import 'server-only';
import { exec, insert, one, query, tx, value } from '../db';
import { campaignGroupIds, campaignIsTracked } from '../format';
import { normalizePhone, parsePhoneList } from '../phone';
import { now, phpDate } from '../time';
import { CAMPAIGN, type CampaignRow, type CampaignStats, type TemplateRow, type UserRow } from '../types';
import { queueMessages, templateFields, UserError, type CardInput } from './messages';

/**
 * Campaigns: create (now or scheduled), dispatch to groups + pasted numbers
 * minus opted-out contacts, cancel, and delivery statistics.
 */

/** Statuses keep changing for a while after sending; stats are cached once a campaign settles. */
const SETTLE_SECONDS = 3 * 86400;
/** Replies counted within this long after the message went out. */
const REPLY_WINDOW = 3 * 86400;

export interface CampaignInput {
  name: string;
  uniqueCode: string;
  groupIds: number[];
  numbers: string;
  parameters: string[];
  cards: CardInput[];
  scheduleAt: number | null;
}

export async function createCampaign(
  user: Pick<UserRow, 'u_id' | 'u_is_new_no'>,
  template: Pick<TemplateRow, 'ut_id' | 'ut_name' | 'ut_template_type' | 'ut_template_category' | 'ut_cards'>,
  data: CampaignInput,
  headerFiles: File[],
  cardFiles: (File | null)[],
): Promise<CampaignRow> {
  if (await value('SELECT 1 FROM js_user_campaign WHERE uc_unique_code = $1 LIMIT 1', [data.uniqueCode])) {
    throw new UserError('This campaign was already submitted.');
  }
  const [numbers] = parsePhoneList(data.numbers);
  if (!numbers.length && !data.groupIds.length) throw new UserError('Choose at least one group or enter mobile numbers.');
  const [type, fields] = await templateFields(template, data.parameters, headerFiles, data.cards, cardFiles);

  const campaign = await insert<CampaignRow>('js_user_campaign', {
    uc_unique_code: data.uniqueCode,
    uc_name: data.name || `${template.ut_name} · ${phpDate('d M, H:i', data.scheduleAt || now())}`,
    uc_template: template.ut_name,
    uc_template_id: template.ut_id,
    uc_group_ids: data.groupIds.join(',') || null,
    uc_user_id: user.u_id,
    uc_total_contacts: 0,
    uc_status: CAMPAIGN.SCHEDULED,
    uc_scheduled_at: data.scheduleAt || now(),
    uc_payload: JSON.stringify({
      type,
      fields,
      numbers,
      lite: String(template.ut_template_category ?? '').toUpperCase() === 'MARKETING' && Number(user.u_is_new_no) === 1,
    }),
  });

  if (!data.scheduleAt) await dispatchCampaign(campaign.uc_id);
  return (await one<CampaignRow>('SELECT * FROM js_user_campaign WHERE uc_id = $1', [campaign.uc_id]))!;
}

/**
 * Queue the campaign's messages. Claimed atomically, so the scheduler and a
 * "send now" can never both send it. Returns the number queued.
 */
export async function dispatchCampaign(campaignId: number): Promise<number> {
  return tx(async (db) => {
    const campaign = await one<CampaignRow>(
      `UPDATE js_user_campaign SET uc_status = $2, uc_started_at = $3 WHERE uc_id = $1 AND uc_status = $4 RETURNING *`,
      [campaignId, CAMPAIGN.DISPATCHED, now(), CAMPAIGN.SCHEDULED], db,
    );
    if (!campaign) return 0;
    const payload = campaign.uc_payload ?? { type: 'template', fields: {}, numbers: [], lite: false };
    const [numbers, skipped] = await audience(campaign.uc_user_id, campaignGroupIds(campaign), payload.numbers ?? []);
    const queued = await queueMessages(campaign.uc_user_id, campaign.uc_id, campaign.uc_template ?? '', numbers, payload.type ?? 'template', payload.fields ?? {}, !!payload.lite, db);
    // The pasted numbers are no longer needed once every message row exists
    await exec(
      'UPDATE js_user_campaign SET uc_total_contacts = $2, uc_skipped = $3, uc_payload = NULL, uc_stats = NULL, uc_stats_at = 0 WHERE uc_id = $1',
      [campaign.uc_id, queued, skipped], db,
    );
    return queued;
  });
}

/** Scheduled campaigns whose time has come. Returns [campaigns, messages]. */
export async function dispatchDueCampaigns(): Promise<[number, number]> {
  const due = await query<{ uc_id: number }>(
    'SELECT uc_id FROM js_user_campaign WHERE uc_status = $1 AND uc_scheduled_at <= $2 ORDER BY uc_scheduled_at',
    [CAMPAIGN.SCHEDULED, now()],
  );
  let messages = 0;
  for (const c of due) messages += await dispatchCampaign(c.uc_id);
  return [due.length, messages];
}

/** Cancel a scheduled campaign, or the not-yet-sent messages of a running one. Returns messages cancelled. */
export async function cancelCampaign(campaignId: number): Promise<number> {
  return tx(async (db) => {
    const cancelled = await exec('UPDATE js_message SET m_status = 4, m_updated_on = $2 WHERE m_campaign_id = $1 AND m_status = 1', [campaignId, now()], db);
    await exec('UPDATE js_user_campaign SET uc_status = $2, uc_payload = NULL, uc_stats_at = 0 WHERE uc_id = $1', [campaignId, CAMPAIGN.CANCELLED], db);
    return cancelled;
  });
}

/**
 * Unique numbers from the groups and the pasted list, without opted-out
 * contacts or blocked numbers. Returns [numbers, skipped count]. Done in one
 * query instead of chunked round trips.
 */
export async function audience(userId: number, groupIds: number[], numbers: string[]): Promise<[string[], number]> {
  const rows = await query<{ mobile: string; blocked: boolean }>(
    `WITH candidates AS (
       SELECT unnest($3::text[]) AS mobile
       UNION
       SELECT c.cl_mobile_no FROM js_user_groups_contact g JOIN js_user_contact_list c ON c.cl_id = g.contact_id
        WHERE g.group_id = ANY($2::int[]) AND c.cl_user_id = $1 AND c.cl_mobile_no IS NOT NULL
     )
     SELECT mobile, EXISTS (
       SELECT 1 FROM js_user_contact_list o WHERE o.cl_user_id = $1 AND o.cl_mobile_no = candidates.mobile AND o.cl_opt_out = 1
     ) AS blocked FROM candidates`,
    [userId, groupIds, numbers],
  );
  // The block list may hold numbers with a country code; compare normalised
  const blockList = await query<{ ubl_mobile_no: string | null }>('SELECT ubl_mobile_no FROM js_user_block_list WHERE ubl_user_id = $1 AND ubl_dstatus = 0', [userId]);
  const blocked = new Set<string>();
  for (const b of blockList) {
    const n = normalizePhone(b.ubl_mobile_no);
    if (n) blocked.add(n);
  }
  const send: string[] = [];
  for (const r of rows) if (!r.blocked && !blocked.has(r.mobile)) send.push(r.mobile);
  return [send, rows.length - send.length];
}

/**
 * Delivery figures per campaign id: total, pending, sent, delivered, read,
 * failed, skipped (+ replied when withReplies). Cached on the campaign once
 * it has settled; refreshed at most every 30 seconds while active.
 */
export async function campaignStats(campaigns: CampaignRow[], withReplies = false): Promise<Record<number, CampaignStats | null>> {
  const stats: Record<number, CampaignStats | null> = {};
  const refresh: CampaignRow[] = [];
  const t = now();
  for (const c of campaigns) {
    if (!campaignIsTracked(c) || Number(c.uc_status) === CAMPAIGN.SCHEDULED) {
      stats[c.uc_id] = null;
      continue;
    }
    const settled = c.uc_started_at < t - SETTLE_SECONDS && (c.uc_stats?.pending ?? 1) === 0;
    const fresh = !!c.uc_stats && (c.uc_stats_at > t - 30 || (settled && c.uc_stats_at > c.uc_started_at + SETTLE_SECONDS));
    if (fresh && (!withReplies || c.uc_stats?.replied !== undefined)) stats[c.uc_id] = c.uc_stats;
    else refresh.push(c);
  }
  if (!refresh.length) return stats;

  const rows = await query<CampaignStats & { m_campaign_id: number }>(
    `SELECT m_campaign_id,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE m_status IN (1, 6))::int AS pending,
            COUNT(*) FILTER (WHERE m_status = 3 AND COALESCE(m_message_id, '') <> '')::int AS sent,
            COUNT(*) FILTER (WHERE m_status = 3 AND COALESCE(m_message_id, '') <> '' AND m_delivery_status IN ('delivered', 'read'))::int AS delivered,
            COUNT(*) FILTER (WHERE m_status = 3 AND COALESCE(m_message_id, '') <> '' AND m_delivery_status = 'read')::int AS read,
            COUNT(*) FILTER (WHERE m_status = 3 AND (COALESCE(m_message_id, '') = '' OR m_delivery_status = 'failed'))::int AS failed,
            COUNT(*) FILTER (WHERE m_status = 3 AND COALESCE(m_message_id, '') <> '' AND m_delivery_status = 'failed')::int AS delivery_failed,
            COUNT(*) FILTER (WHERE m_status IN (4, 5, 9))::int AS skipped
       FROM js_message WHERE m_campaign_id = ANY($1::int[]) GROUP BY m_campaign_id`,
    [refresh.map((c) => c.uc_id)],
  );
  const byId = new Map(rows.map((r) => [r.m_campaign_id, r]));

  for (const c of refresh) {
    const r = byId.get(c.uc_id);
    const s: CampaignStats = {
      total: r?.total ?? 0, pending: r?.pending ?? 0, sent: r?.sent ?? 0, delivered: r?.delivered ?? 0, read: r?.read ?? 0,
      failed: r?.failed ?? 0, delivery_failed: r?.delivery_failed ?? 0, skipped: (r?.skipped ?? 0) + Number(c.uc_skipped), // opted out before queueing
    };
    if (withReplies) s.replied = await replies(c.uc_id);
    else if (c.uc_stats?.replied !== undefined) s.replied = c.uc_stats.replied;
    await exec('UPDATE js_user_campaign SET uc_stats = $2, uc_stats_at = $3 WHERE uc_id = $1', [c.uc_id, JSON.stringify(s), t]);
    stats[c.uc_id] = s;
  }
  return stats;
}

/** Recipients who wrote back within REPLY_WINDOW of receiving the campaign. */
async function replies(campaignId: number): Promise<number> {
  return (await value<number>(
    `SELECT COUNT(DISTINCT c.m_mobile_no)::int FROM js_message c
       WHERE c.m_campaign_id = $1 AND c.m_status = 3 AND c.m_message_id <> ''
         AND EXISTS (SELECT 1 FROM js_message i
                      WHERE i.m_user_id = c.m_user_id AND i.m_mobile_no = c.m_mobile_no AND i.m_is_incoming = 1
                        AND i.m_created_on >= c.m_in_process_on AND i.m_created_on < c.m_in_process_on + $2)`,
    [campaignId, REPLY_WINDOW],
  )) ?? 0;
}
