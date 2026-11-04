import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { config } from '@/lib/config';
import { query } from '@/lib/db';
import { numberFormat, ucfirst } from '@/lib/text';
import { dayStart, phpDate } from '@/lib/time';
import { PageTitle } from '@/components/PageTitle';
import { DateRangeInput } from '@/components/ui';
import { dateInput, dateRange, filled, input, intParam, waUsers, type Params } from '../_lib';

/** Per-user message summary (ReportController::summary). */
export default async function SummaryPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAdmin();
  const sp = await searchParams;
  const dtInput = dateInput(sp, true);
  const range = dateRange(dtInput);
  const queFrom = dayStart() - config.queTime;
  const userId = filled(sp, 'user_id') ? intParam(sp, 'user_id') : null;

  // One scan of the date range (js_message_created_idx) for sent / error / incoming
  const args: unknown[] = [userId];
  const rangeSql = range ? `AND m_created_on BETWEEN $2 AND $3` : '';
  if (range) args.push(range[0], range[1]);
  const [activity, que, allUsers] = await Promise.all([
    query<{ m_user_id: number; col: string; n: number }>(
      `SELECT m_user_id,
              CASE WHEN m_is_incoming = 1 THEN '#Incoming'
                   WHEN m_message_id <> '' THEN COALESCE(NULLIF(m_delivery_status, ''), 'sent')
                   ELSE '#Error' END AS col,
              COUNT(*)::int AS n
         FROM js_message
        WHERE m_dstatus = 0 ${rangeSql}
          AND ($1::int IS NULL OR m_user_id = $1)
          AND (m_is_incoming = 1 OR (m_is_incoming = 2 AND m_status = 3 AND (m_message_id <> '' OR m_message_id = '')))
        GROUP BY 1, 2`,
      args,
    ),
    // Live queue window; one branch per partial index (js_message_queue_idx / js_message_processing_idx)
    query<{ m_user_id: number; n: number }>(
      `SELECT m_user_id, SUM(n)::int AS n FROM (
         SELECT m_user_id, COUNT(*) AS n FROM js_message
          WHERE m_status = 1 AND m_is_incoming = 2 AND m_dstatus = 0 AND m_created_on >= $1 AND ($2::int IS NULL OR m_user_id = $2) GROUP BY 1
         UNION ALL
         SELECT m_user_id, COUNT(*) FROM js_message
          WHERE m_status = 6 AND m_is_incoming = 2 AND m_dstatus = 0 AND m_created_on >= $1 AND ($2::int IS NULL OR m_user_id = $2) GROUP BY 1
       ) q GROUP BY 1`,
      [queFrom, userId],
    ),
    waUsers(),
  ]);

  // Same row / column order as the Laravel arrays: sent rows first, then Que, Error, Incoming
  const rows = new Map<number, Record<string, number>>();
  const add = (uid: number, col: string, n: number) => {
    const r = rows.get(uid) ?? {};
    r[col] = (r[col] ?? 0) + n;
    rows.set(uid, r);
  };
  const sorted = [...activity].sort((a, b) => a.m_user_id - b.m_user_id);
  const statusCols = new Set<string>();
  for (const r of sorted) if (!r.col.startsWith('#')) { add(r.m_user_id, r.col, r.n); statusCols.add(r.col); }
  for (const r of [...que].sort((a, b) => a.m_user_id - b.m_user_id)) add(r.m_user_id, 'Que', r.n);
  for (const col of ['Error', 'Incoming']) for (const r of sorted) if (r.col === '#' + col) add(r.m_user_id, col, r.n);
  const columns = [...[...statusCols].sort(), 'Que', 'Error', 'Incoming'];

  const ids = [...rows.keys()];
  const info = ids.length
    ? await query<{ u_id: number; u_username: string | null; u_last_wa_send: number }>('SELECT u_id, u_username, u_last_wa_send FROM js_user WHERE u_id = ANY($1::int[])', [ids])
    : [];
  const users = new Map(info.map((u) => [u.u_id, u]));
  const totals: Record<string, number> = {};
  for (const r of rows.values()) for (const [c, n] of Object.entries(r)) totals[c] = (totals[c] ?? 0) + n;
  const selected = input(sp, 'user_id') ?? '';

  return (
    <>
      <PageTitle title="Summary" home="/wamaster/dashboard" />
      <div className="card">
        <div className="card-header">
          <form method="get" className="row g-2 align-items-center filter-bar">
            <div className="col-md-3"><DateRangeInput name="wa_date" defaultValue={dtInput} placeholder="" /></div>
            <div className="col-md-3">
              <select className="form-select" name="user_id" defaultValue={selected} aria-label="User">
                <option value="">All users</option>
                {allUsers.map((u) => <option key={u.u_id} value={String(u.u_id)}>{u.u_username}</option>)}
              </select>
            </div>
            <div className="col-auto"><button className="btn btn-secondary">Search</button></div>
          </form>
        </div>
        <div className="card-body table-responsive">
          <table className="table table-sm table-striped align-middle table-report mb-0">
            <thead className="table-light">
              <tr><th>#</th><th>User</th>{columns.map((c) => <th key={c} className="num">{ucfirst(c)}</th>)}<th>Last WA Send</th></tr>
            </thead>
            <tbody>
              {rows.size ? [...rows.entries()].map(([uid, row], i) => {
                const t = users.get(uid)?.u_last_wa_send ?? 0;
                return (
                  <tr key={uid}>
                    <td>{i + 1}</td>
                    <td><Link href={`/wamaster/users/${uid}`}>{users.get(uid)?.u_username ?? uid}</Link></td>
                    {columns.map((c) => <td key={c} className="num">{numberFormat(row[c] ?? 0)}</td>)}
                    <td className="small">{t ? phpDate('d M H:i', t) : '—'}</td>
                  </tr>
                );
              }) : (
                <tr><td colSpan={columns.length + 3} className="text-center text-muted py-4">No activity for this period.</td></tr>
              )}
            </tbody>
            {rows.size > 0 && (
              <tfoot className="table-light"><tr><th colSpan={2}>Total</th>{columns.map((c) => <th key={c} className="num">{numberFormat(totals[c] ?? 0)}</th>)}<th /></tr></tfoot>
            )}
          </table>
        </div>
      </div>
    </>
  );
}
