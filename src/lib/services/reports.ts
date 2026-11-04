import 'server-only';
import { config } from '../config';
import { query } from '../db';
import { ucfirst } from '../text';
import { dayStart, monthStart, phpDate } from '../time';

/**
 * Status matrices for dashboards and the daily email reports (legacy
 * email_template/wa_report.php and wa_templates.php).
 * A matrix is { columns, rows: [label, {col: n}][] , totals }.
 */

export const TEMPLATE_TYPES = ['template', 'flow', 'carousel', 'catalogue'];

export interface Matrix {
  columns: string[];
  rows: [string, Record<string, number>][];
  totals: Record<string, number>;
}

/** Natural, case-insensitive sort (PHP ksort SORT_NATURAL | SORT_FLAG_CASE). */
export const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** Delivery-status columns first (alphabetical), then the fixed trailing columns; totals per column. */
export function buildMatrix(rows: Map<string, Record<string, number>>, trailing: string[], sort = true): Matrix {
  const cols = new Set<string>();
  for (const r of rows.values()) for (const c of Object.keys(r)) if (!trailing.includes(c)) cols.add(c);
  const columns = [...[...cols].sort(), ...trailing];
  const list = [...rows.entries()];
  if (sort) list.sort(([a], [b]) => naturalCompare(a, b));
  const totals: Record<string, number> = {};
  for (const [, r] of list) for (const [c, n] of Object.entries(r)) totals[c] = (totals[c] ?? 0) + n;
  return { columns, rows: list, totals };
}

/**
 * Template × delivery-status counts for one user (or all users, labelled by
 * username) in [from, to): sent by status, API errors, and the live queue.
 * One scan with conditional aggregates instead of three grouped queries.
 */
export async function templateMatrix(opts: { userId?: number | null; from: number; to?: number; byUser?: boolean; types?: string[] | null }): Promise<Matrix> {
  const { userId = null, from, to = 2147483647, byUser = false, types = TEMPLATE_TYPES } = opts;
  const queFrom = dayStart() - config.queTime;
  const rows = await query<{ m_user_id: number; name: string | null; status: string; n: number }>(
    `SELECT m_user_id, m_msg_template_name AS name,
            CASE WHEN m_status = 3 AND COALESCE(m_message_id, '') <> '' THEN COALESCE(NULLIF(m_delivery_status, ''), 'sent')
                 WHEN m_status = 3 THEN '#Error'
                 WHEN m_status = 1 THEN '#Que'
                 ELSE '#In Process' END AS status,
            COUNT(*)::int AS n
       FROM js_message
      WHERE m_is_incoming = 2 AND m_dstatus = 0
        AND ($1::int IS NULL OR m_user_id = $1)
        AND ($5::text[] IS NULL OR m_msg_type = ANY($5::text[]))
        AND ((m_status = 3 AND m_in_process_on >= $2 AND m_in_process_on < $3)
          OR (m_status IN (1, 6) AND m_created_on >= $4))
      GROUP BY 1, 2, 3`,
    [userId, from, to, queFrom, types],
  );

  const names = byUser ? await usernames([...new Set(rows.map((r) => r.m_user_id))]) : new Map<number, string>();
  const data = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const tpl = r.name || (byUser ? '(none)' : '-');
    const label = byUser ? `${names.get(r.m_user_id) ?? '#' + r.m_user_id} — ${tpl}` : tpl;
    const col = r.status.startsWith('#') ? r.status.slice(1) : ucfirst(r.status);
    const row = data.get(label) ?? {};
    row[col] = (row[col] ?? 0) + r.n;
    data.set(label, row);
  }
  return buildMatrix(data, ['Error', 'Que', 'In Process']);
}

async function usernames(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const rows = await query<{ u_id: number; u_username: string | null }>('SELECT u_id, u_username FROM js_user WHERE u_id = ANY($1::int[])', [ids]);
  return new Map(rows.map((r) => [r.u_id, r.u_username ?? '#' + r.u_id]));
}

/** Admin report: per-user activity today plus per-user template breakdown. */
export async function adminSummary(): Promise<{ users: Matrix; templates: Matrix }> {
  const today = dayStart();
  const queFrom = today - config.queTime;
  const rows = await query<{ m_user_id: number; col: string; n: number }>(
    `SELECT m_user_id,
            CASE WHEN m_is_incoming = 1 THEN 'Incoming'
                 WHEN m_status = 3 AND COALESCE(m_message_id, '') <> '' THEN COALESCE(NULLIF(m_delivery_status, ''), 'sent')
                 WHEN m_status = 3 THEN '#Error'
                 WHEN m_status = 1 THEN '#Que'
                 ELSE '#In Process' END AS col,
            COUNT(*)::int AS n
       FROM js_message
      WHERE m_dstatus = 0 AND (
            (m_is_incoming = 1 AND m_created_date = $1)
         OR (m_is_incoming = 2 AND m_status = 3 AND m_in_process_on >= $1)
         OR (m_is_incoming = 2 AND m_status = 1 AND m_created_on >= $2)
         OR (m_is_incoming = 2 AND m_status = 6))
      GROUP BY 1, 2`,
    [today, queFrom],
  );
  const users = new Map<number, Record<string, number>>();
  for (const r of rows) {
    const u = users.get(r.m_user_id) ?? {};
    const col = r.col.startsWith('#') ? r.col.slice(1) : r.col === 'Incoming' ? 'Incoming' : ucfirst(r.col);
    u[col] = (u[col] ?? 0) + r.n;
    if (!r.col.startsWith('#') && r.col !== 'Incoming') u['Total Send'] = (u['Total Send'] ?? 0) + r.n;
    users.set(r.m_user_id, u);
  }
  const ids = [...users.keys()];
  const tillDate = ids.length
    ? await query<{ m_user_id: number; n: number }>(
      `SELECT m_user_id, COUNT(*)::int AS n FROM js_message
        WHERE m_user_id = ANY($1::int[]) AND m_is_incoming = 2 AND m_dstatus = 0 AND m_status = 3 AND m_message_id <> ''
          AND m_msg_type = ANY($2::text[]) AND (m_delivery_status IS NULL OR m_delivery_status <> 'failed')
        GROUP BY 1`, [ids, TEMPLATE_TYPES])
    : [];
  const till = new Map(tillDate.map((r) => [r.m_user_id, r.n]));
  const info = ids.length
    ? await query<{ u_id: number; u_username: string | null; u_last_wa_send: number }>('SELECT u_id, u_username, u_last_wa_send FROM js_user WHERE u_id = ANY($1::int[])', [ids])
    : [];
  const byId = new Map(info.map((u) => [u.u_id, u]));

  const labelled = new Map<string, Record<string, number>>();
  for (const [uid, cols] of users) {
    const u = byId.get(uid);
    const label = (u?.u_username || '#' + uid) + (u?.u_last_wa_send ? ` (last ${phpDate('d-m-Y H:i', u.u_last_wa_send)})` : '');
    labelled.set(label, { ...cols, 'WA Send Till Date': till.get(uid) ?? 0 });
  }
  return {
    users: buildMatrix(labelled, ['Total Send', 'Que', 'In Process', 'Error', 'Incoming', 'WA Send Till Date']),
    templates: await templateMatrix({ from: today, byUser: true }),
  };
}

/** Client report: template breakdown for today and for the month to date. */
export async function userTemplateReport(userId: number): Promise<{ today: Matrix; month: Matrix }> {
  return {
    today: await templateMatrix({ userId, from: dayStart() }),
    month: await templateMatrix({ userId, from: monthStart() }),
  };
}
