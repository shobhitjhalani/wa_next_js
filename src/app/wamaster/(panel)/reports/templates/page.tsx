import { requireAdmin } from '@/lib/auth';
import { config } from '@/lib/config';
import { query } from '@/lib/db';
import { TEMPLATE_TYPES } from '@/lib/services/reports';
import { numberFormat, ucfirst } from '@/lib/text';
import { dayStart } from '@/lib/time';
import { PageTitle } from '@/components/PageTitle';
import { DateRangeInput } from '@/components/ui';
import { corporates, dateInput, dateRange, filled, input, intParam, waUsers, type Params } from '../_lib';

/** Template × delivery status per user (ReportController::templates). */
export default async function TemplatesReportPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAdmin();
  const sp = await searchParams;
  const dtInput = dateInput(sp, true);
  const range = dateRange(dtInput);
  const queFrom = dayStart() - config.queTime;
  const userId = filled(sp, 'user_id') ? intParam(sp, 'user_id') : null;
  const parentId = filled(sp, 'parent_id') ? intParam(sp, 'parent_id') : null;

  const userSql = `($1::int IS NULL OR m_user_id = $1)
    AND ($2::int IS NULL OR m_user_id IN (SELECT u_id FROM js_user WHERE u_parent_id = $2))`;
  const sentArgs: unknown[] = [userId, parentId, TEMPLATE_TYPES];
  const rangeSql = range ? 'AND m_created_on BETWEEN $4 AND $5' : '';
  if (range) sentArgs.push(range[0], range[1]);

  const [sent, que, allUsers, parents] = await Promise.all([
    // Sent (by delivery status) and API errors share the m_status = 3 rows of the range: one scan
    query<{ m_user_id: number; name: string | null; col: string; n: number }>(
      `SELECT m_user_id, m_msg_template_name AS name,
              CASE WHEN m_message_id <> '' THEN COALESCE(NULLIF(m_delivery_status, ''), 'sent') ELSE '#Error' END AS col,
              COUNT(*)::int AS n
         FROM js_message
        WHERE m_is_incoming = 2 AND m_dstatus = 0 AND m_status = 3 ${rangeSql} AND ${userSql}
          AND ((m_message_id <> '' AND m_msg_type = ANY($3::text[])) OR (m_message_id = '' AND m_msg_type = 'template'))
        GROUP BY 1, 2, 3`,
      sentArgs,
    ),
    // Only the live queue window; one branch per partial index
    query<{ m_user_id: number; name: string | null; n: number }>(
      `SELECT m_user_id, name, SUM(n)::int AS n FROM (
         SELECT m_user_id, m_msg_template_name AS name, COUNT(*) AS n FROM js_message
          WHERE m_status = 1 AND m_is_incoming = 2 AND m_dstatus = 0 AND m_created_on >= $3 AND m_msg_type = 'template' AND ${userSql} GROUP BY 1, 2
         UNION ALL
         SELECT m_user_id, m_msg_template_name, COUNT(*) FROM js_message
          WHERE m_status = 6 AND m_is_incoming = 2 AND m_dstatus = 0 AND m_created_on >= $3 AND m_msg_type = 'template' AND ${userSql} GROUP BY 1, 2
       ) q GROUP BY 1, 2`,
      [userId, parentId, queFrom],
    ),
    waUsers(),
    corporates(),
  ]);

  const byKey = (a: { m_user_id: number; name: string | null }, b: { m_user_id: number; name: string | null }) =>
    a.m_user_id - b.m_user_id || (a.name ?? '').localeCompare(b.name ?? '');
  const rows = new Map<string, Record<string, number>>();
  const add = (uid: number, name: string | null, col: string, n: number) => {
    const key = `${uid}|${name ?? ''}`;
    const r = rows.get(key) ?? {};
    r[col] = (r[col] ?? 0) + n;
    rows.set(key, r);
  };
  const statusCols = new Set<string>();
  const sentSorted = [...sent].sort(byKey);
  for (const r of sentSorted) if (r.col !== '#Error') { add(r.m_user_id, r.name, r.col, r.n); statusCols.add(r.col); }
  for (const r of [...que].sort(byKey)) add(r.m_user_id, r.name, 'Que', r.n);
  for (const r of sentSorted) if (r.col === '#Error') add(r.m_user_id, r.name, 'Error', r.n);
  const columns = [...[...statusCols].sort(), 'Que', 'Error'];

  const ids = [...new Set([...rows.keys()].map((k) => Number(k.split('|')[0])))];
  const names = ids.length
    ? new Map((await query<{ u_id: number; u_username: string | null }>('SELECT u_id, u_username FROM js_user WHERE u_id = ANY($1::int[])', [ids])).map((u) => [u.u_id, u.u_username]))
    : new Map<number, string | null>();

  return (
    <>
      <PageTitle title="Templates Report" home="/wamaster/dashboard" />
      <div className="card">
        <div className="card-header">
          <form method="get" className="row g-2 align-items-center filter-bar">
            <div className="col-md-3"><DateRangeInput name="wa_date" defaultValue={dtInput} placeholder="" /></div>
            <div className="col-md-3">
              <select className="form-select" name="parent_id" defaultValue={input(sp, 'parent_id') ?? ''} aria-label="Corporate account">
                <option value="">All corporate accounts</option>
                {parents.map((u) => <option key={u.u_id} value={String(u.u_id)}>{u.u_name}</option>)}
              </select>
            </div>
            <div className="col-md-3">
              <select className="form-select" name="user_id" defaultValue={input(sp, 'user_id') ?? ''} aria-label="User">
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
              <tr><th>#</th><th>User</th><th>Template</th>{columns.map((c) => <th key={c} className="num">{ucfirst(c)}</th>)}<th className="num">Total</th></tr>
            </thead>
            <tbody>
              {rows.size ? [...rows.entries()].map(([key, row], i) => {
                const sep = key.indexOf('|');
                const uid = Number(key.slice(0, sep));
                const tpl = key.slice(sep + 1);
                return (
                  <tr key={key}>
                    <td>{i + 1}</td>
                    <td>{names.get(uid) ?? uid}</td>
                    <td>{tpl || '—'}</td>
                    {columns.map((c) => <td key={c} className="num">{numberFormat(row[c] ?? 0)}</td>)}
                    <th className="num">{numberFormat(Object.values(row).reduce((a, b) => a + b, 0))}</th>
                  </tr>
                );
              }) : (
                <tr><td colSpan={columns.length + 4} className="text-center text-muted py-4">No template messages for this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
