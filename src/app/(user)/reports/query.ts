import 'server-only';
import { config } from '@/lib/config';
import { sqlDir, tableState, type TableState } from '@/lib/datatable';
import { like, query, tx } from '@/lib/db';
import { sp } from '@/lib/http';
import type { MessageRow } from '@/lib/types';
import { parseDateRange, todayString } from '@/lib/time';

/**
 * Filters shared by the message report pages and their CSV export
 * (User\ReportController::query). Filters default to today, like the legacy pages.
 */

export type ReportType = 'queue' | 'all' | 'failed' | 'error';
export type Params = Record<string, string | string[] | undefined> | URLSearchParams;

export const PAGE_SIZE = config.site.pageSize;

/** Sortable columns of the report tables → SQL (whitelist). */
export const REPORT_SORTS = { date: 'm_id', mobile: 'm_mobile_no', updated: 'm_updated_on', status: 'm_status' } as const;
export type ReportSort = keyof typeof REPORT_SORTS;
export const REPORT_TABLE = { sorts: Object.keys(REPORT_SORTS) as ReportSort[], sort: 'date' as ReportSort, dir: 'desc' as const, perPage: PAGE_SIZE };
export const reportTable = (params: Params) => tableState<ReportSort>(params, REPORT_TABLE);

/**
 * Statuses each report covers. 'all' / 'failed' have no status condition in
 * Laravel; listing every status (config('wa.message_status') plus the unused
 * 0 / 2) turns the scan of js_message_user_dir_status_idx
 * (m_user_id, m_is_incoming, m_status, m_created_on) into one range per status
 * instead of every outgoing message of the user.
 */
const ANY_STATUS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const STATUSES: Record<ReportType, number[]> = { queue: [1, 6], error: [3], all: ANY_STATUS, failed: ANY_STATUS };

/** `wa_date` as shown in the filter: today when absent, '' (no date filter) when cleared. */
export function dateInput(params: Params): string {
  const present = params instanceof URLSearchParams ? params.has('wa_date') : params.wa_date !== undefined;
  return present ? sp(params, 'wa_date') : todayString();
}

/** WHERE condition (without the keyword) and params of a report on js_message. */
export function reportFilter(userId: number, type: ReportType, params: Params): { where: string; args: unknown[] } {
  const args: unknown[] = [userId, STATUSES[type]];
  const where: string[] = ['m_user_id = $1', 'm_is_incoming = 2', 'm_status = ANY($2::smallint[])', 'm_dstatus = 0'];
  const add = (sql: string, ...values: unknown[]) => {
    let s = sql;
    for (const v of values) { args.push(v); s = s.replace('?', `$${args.length}`); }
    where.push(s);
  };

  if (type === 'failed') where.push(`m_delivery_status = 'failed'`);
  if (type === 'error') where.push(`COALESCE(m_message_id, '') = ''`); // legacy rows store a missing id as NULL
  const range = parseDateRange(dateInput(params));
  if (range) add('m_created_on BETWEEN ? AND ?', range[0], range[1]); // whereBetween: both bounds inclusive
  const mobile = sp(params, 'mobile_no');
  if (mobile) add('m_mobile_no = ?', mobile);
  const template = sp(params, 'template');
  if (template) add('m_msg_template_name = ?', template);
  const del = sp(params, 'del_status');
  if (del) add('m_delivery_status = ?', del);
  const msgType = sp(params, 'msg_type');
  if (msgType === '1') where.push(`m_msg_type = 'template'`);
  if (msgType === '2') where.push(`m_msg_type <> 'template'`);
  // Table search: mobile number, template name or message text
  const q = sp(params, 'q').slice(0, 100);
  if (q) {
    args.push(like(q));
    const n = args.length;
    where.push(`(m_mobile_no LIKE '%' || $${n} || '%' OR m_msg_template_name ILIKE '%' || $${n} || '%' OR m_content ILIKE '%' || $${n} || '%')`);
  }

  return { where: where.join(' AND '), args };
}

/**
 * Run a report query with plain index scans disabled for its transaction.
 * m_created_on is almost perfectly correlated with the heap order, so for any
 * range longer than a day or two the planner prefers walking
 * js_message_created_idx through every user's messages of the period
 * (0.35-1.9 s for a month of a busy account) over a bitmap scan of
 * js_message_user_dir_status_idx for just this user (20-60 ms).
 */
export function reportQuery<T>(sql: string, args: unknown[]): Promise<T[]> {
  return tx(async (db) => {
    await db.query('SET LOCAL enable_indexscan = off');
    return query<T>(sql, args, db);
  });
}

export type ReportMessage = Pick<MessageRow,
  'm_id' | 'm_created_on' | 'm_mobile_no' | 'm_content' | 'm_msg_template_name' | 'm_msg_type' | 'm_msg_template_para' | 'm_image'
  | 'm_response_file_name' | 'm_updated_on' | 'm_status' | 'm_message_id' | 'm_delivery_status' | 'm_status_response'>;

const LIST_COLUMNS = `m_id, m_created_on, m_mobile_no, m_content, m_msg_template_name, m_msg_type, m_msg_template_para, m_image,
  m_response_file_name, m_updated_on, m_status, m_message_id, m_delivery_status, m_status_response`;

/** One page in the table's order (default newest first) and the total, from a single pass over the matching rows. */
export async function reportPage(userId: number, type: ReportType, params: Params, table: TableState<ReportSort>): Promise<{ total: number; rows: ReportMessage[] }> {
  const { where, args } = reportFilter(userId, type, params);
  args.push((table.page - 1) * table.perPage);
  const col = REPORT_SORTS[table.sort];
  const dir = sqlDir(table.dir);
  const rows = await reportQuery<ReportMessage & { total: number }>(
    `WITH f AS MATERIALIZED (SELECT m_id, ${col} AS s FROM js_message WHERE ${where})
     SELECT t.total, p.*
       FROM (SELECT COUNT(*)::int AS total FROM f) t
       LEFT JOIN LATERAL (
         SELECT ${LIST_COLUMNS} FROM js_message
          WHERE m_id IN (SELECT m_id FROM f ORDER BY s ${dir} NULLS LAST, m_id ${dir} LIMIT ${table.perPage} OFFSET $${args.length})
       ) p ON true
      ORDER BY p.${col} ${dir} NULLS LAST, p.m_id ${dir}`,
    args,
  );
  return { total: rows[0]?.total ?? 0, rows: rows.filter((r) => r.m_id != null) };
}

/** Names for the template filter. */
export function templateNames(userId: number): Promise<string[]> {
  return query<{ ut_name: string }>(
    'SELECT ut_name FROM js_user_templates WHERE ut_user_id = $1 AND ut_dstatus = 0 ORDER BY ut_name', [userId],
  ).then((rows) => rows.map((r) => r.ut_name));
}
