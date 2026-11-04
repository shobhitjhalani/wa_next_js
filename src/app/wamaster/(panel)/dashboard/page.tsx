import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { config } from '@/lib/config';
import { one, query, value } from '@/lib/db';
import { numberFormat, ucfirst } from '@/lib/text';
import { dayStart, monthStart, now, phpDate } from '@/lib/time';
import { USER_TYPE } from '@/lib/types';
import { PageTitle } from '@/components/PageTitle';

/** Admin dashboard (Admin\DashboardController::index + admin/dashboard.blade.php). */
export default async function AdminDashboardPage() {
  const me = await requireAdmin();
  const today = dayStart();
  const queFrom = today - config.queTime;
  const year = config.site.fYear;
  const mStart = monthStart();
  const prev = new Date(mStart * 1000);
  prev.setMonth(prev.getMonth() - 1);
  const lastMonthStart = monthStart(Math.floor(prev.getTime() / 1000));

  const [summaryRows, sentToday, lastSentAt, inProcess, connectedUsers, revenue, expiredUsers] = await Promise.all([
    // Per-user "Today Summary" in one pass: today's sent (by delivery status), API errors and incoming,
    // plus everything still queued / processing inside the queue window.
    query<{ uid: number; col: string; n: number }>(
      `SELECT m_user_id AS uid, col, COUNT(*)::int AS n FROM (
         SELECT m_user_id,
                CASE WHEN m_is_incoming = 1 THEN 'Incoming'
                     WHEN m_status = 1 THEN 'Que'
                     WHEN m_status = 6 THEN 'Processing'
                     WHEN m_message_id = '' THEN 'Error'
                     WHEN m_message_id <> '' THEN 's:' || COALESCE(NULLIF(m_delivery_status, ''), 'sent')
                END AS col
           FROM js_message
          WHERE m_dstatus = 0 AND m_created_on >= $1
            AND ((m_is_incoming = 2 AND m_status IN (1, 6))
                 OR (m_created_date = $2 AND (m_is_incoming = 1 OR (m_is_incoming = 2 AND m_status = 3))))
       ) t WHERE col IS NOT NULL
       GROUP BY m_user_id, col ORDER BY m_user_id`,
      [queFrom, today],
    ),
    // Both use js_message_sent_updated_idx (partial index on m_updated_on for sent outgoing messages)
    value<number>(
      `SELECT COUNT(*)::int FROM js_message
        WHERE m_is_incoming = 2 AND m_dstatus = 0 AND m_status = 3 AND m_delivery_status IN ('read', 'sent', 'delivered') AND m_updated_on >= $1`,
      [today],
    ),
    value<number>(
      `SELECT m_updated_on FROM js_message WHERE m_is_incoming = 2 AND m_dstatus = 0 AND m_status = 3 AND m_updated_on > 0
        ORDER BY m_updated_on DESC LIMIT 1`,
    ),
    value<number>('SELECT COUNT(*)::int FROM js_message WHERE m_is_incoming = 2 AND m_dstatus = 0 AND m_status = 6'),
    value<number>(
      'SELECT COUNT(*)::int FROM js_user WHERE u_dstatus = 0 AND u_type = $1 AND u_status = 1 AND u_wa_plan_status = 1',
      [USER_TYPE.WHATSAPP],
    ),
    one<Record<'yt' | 'yn' | 'mt' | 'mn' | 'lt' | 'ln', number>>(
      `SELECT COALESCE(SUM(ur_amount), 0) AS yt, COUNT(*)::int AS yn,
              COALESCE(SUM(ur_amount) FILTER (WHERE ur_created_on BETWEEN $2 AND $3), 0) AS mt,
              COUNT(*) FILTER (WHERE ur_created_on BETWEEN $2 AND $3)::int AS mn,
              COALESCE(SUM(ur_amount) FILTER (WHERE ur_created_on BETWEEN $4 AND $5), 0) AS lt,
              COUNT(*) FILTER (WHERE ur_created_on BETWEEN $4 AND $5)::int AS ln
         FROM js_user_recharge WHERE ur_dstatus = 0 AND ur_year = $1 AND ur_generate_invoice = 1`,
      [year, mStart, now(), lastMonthStart, mStart - 1],
    ),
    query<{ u_id: number; u_username: string | null; u_valid_till: number }>(
      `SELECT u_id, u_username, u_valid_till FROM js_user
        WHERE u_dstatus = 0 AND u_type = $1 AND u_status = 1 AND u_wa_plan_status = 2 AND u_valid_till > 0
        ORDER BY u_valid_till`,
      [USER_TYPE.WHATSAPP],
    ),
  ]);

  // Build the per-user table in the same order as the Laravel controller
  const statusSet = new Set<string>();
  const summary = new Map<number, Record<string, number>>();
  const add = (uid: number, col: string, n: number) => {
    const row = summary.get(uid) ?? {};
    row[col] = (row[col] ?? 0) + n;
    summary.set(uid, row);
  };
  for (const r of summaryRows) {
    if (r.col.startsWith('s:')) {
      statusSet.add(r.col.slice(2));
      add(r.uid, r.col.slice(2), r.n);
    }
  }
  let pending = 0;
  for (const col of ['Que', 'Processing', 'Error', 'Incoming']) {
    for (const r of summaryRows) {
      if (r.col !== col) continue;
      add(r.uid, col, r.n);
      if (col === 'Que') pending += r.n;
    }
  }
  const statusCols = [...[...statusSet].sort(), 'Que', 'Processing', 'Error', 'Incoming'];
  const summaryUsers = summary.size
    ? new Map((await query<{ u_id: number; u_username: string | null; u_last_wa_send: number }>(
      'SELECT u_id, u_username, u_last_wa_send FROM js_user WHERE u_id = ANY($1::int[])', [[...summary.keys()]],
    )).map((u) => [u.u_id, u]))
    : new Map<number, { u_id: number; u_username: string | null; u_last_wa_send: number }>();

  const lastSent = Number(lastSentAt ?? 0);
  const cards: [string, number, string, string, string][] = [
    ['Sent Today', sentToday ?? 0, 'ri-send-plane-line', 'success', '/wamaster/reports/messages/send'],
    ['Pending in Queue', pending, 'ri-time-line', 'warning', '/wamaster/reports/messages/que'],
    ['In Process', inProcess ?? 0, 'ri-loader-4-line', 'info', '/wamaster/reports/messages/in_process'],
    ['Active WA Users', connectedUsers ?? 0, 'ri-user-follow-line', 'primary', '/wamaster/users?ut=2'],
  ];
  const revenueRows: [string, number, number][] = [
    ['Total Collection', revenue?.yt ?? 0, revenue?.yn ?? 0],
    ['This Month', revenue?.mt ?? 0, revenue?.mn ?? 0],
    ['Last Month', revenue?.lt ?? 0, revenue?.ln ?? 0],
  ];

  return (
    <>
      <PageTitle title="Dashboard" home="/wamaster/dashboard" />
      <h4 className="fs-16 mb-1">Hello, {me.emp_name}!</h4>
      <p className="text-muted mb-4">Here&apos;s what&apos;s happening today. Last message sent: {lastSent ? phpDate('d M Y H:i', lastSent) : '—'}</p>

      <div className="row">
        {cards.map(([label, val, icon, color, link]) => (
          <div className="col-xl-3 col-md-6" key={label}>
            <div className="card card-animate">
              <div className="card-body">
                <div className="d-flex align-items-center">
                  <div className="flex-grow-1">
                    <p className="text-uppercase fw-medium text-muted mb-1">{label}</p>
                    <h4 className="fs-22 fw-semibold mb-2">{numberFormat(val)}</h4>
                    <Link href={link} className="small">View</Link>
                  </div>
                  <div className="avatar-sm flex-shrink-0">
                    <span className={`avatar-title bg-${color}-subtle rounded fs-3`}><i className={`${icon} text-${color}`} /></span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="row">
        <div className="col-xl-8">
          <div className="card">
            <div className="card-header"><h4 className="card-title mb-0">Today Summary</h4></div>
            <div className="card-body">
              {summary.size === 0 ? (
                <p className="text-muted mb-0">No activity today.</p>
              ) : (
                <div className="table-responsive">
                  <table className="table table-sm table-striped align-middle table-report mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>User</th>
                        {statusCols.map((col) => <th className="num" key={col}>{ucfirst(col)}</th>)}
                        <th>Last WA Send</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...summary.entries()].map(([uid, row]) => {
                        const u = summaryUsers.get(uid);
                        const t = Number(u?.u_last_wa_send ?? 0);
                        return (
                          <tr key={uid}>
                            <td><Link href={`/wamaster/users/${uid}`}>{u?.u_username ?? uid}</Link></td>
                            {statusCols.map((col) => <td className="num" key={col}>{numberFormat(row[col] ?? 0)}</td>)}
                            <td className="small">{t ? phpDate('d M H:i', t) : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="col-xl-4">
          <div className="card">
            <div className="card-header"><h4 className="card-title mb-0">Revenue ({year})</h4></div>
            <div className="card-body">
              {revenueRows.map(([label, total, n]) => (
                <div className="d-flex justify-content-between border-bottom py-2" key={label}>
                  <span className="text-muted">{label}</span>
                  <span><b>Rs. {numberFormat(total, 2)}</b> <span className="text-muted small">({n})</span></span>
                </div>
              ))}
              <Link href="/wamaster/reports/recharges" className="btn btn-sm btn-soft-primary mt-3">Recharge report</Link>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h4 className="card-title mb-0">Users Expired</h4></div>
            <div className="card-body p-0">
              <ul className="list-group list-group-flush">
                {expiredUsers.length ? expiredUsers.map((u) => (
                  <li className="list-group-item d-flex justify-content-between" key={u.u_id}>
                    <Link href={`/wamaster/users/${u.u_id}`}>{u.u_username}</Link>
                    <span className="text-danger small">{phpDate('d M Y', u.u_valid_till)}</span>
                  </li>
                )) : (
                  <li className="list-group-item text-muted">None</li>
                )}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
