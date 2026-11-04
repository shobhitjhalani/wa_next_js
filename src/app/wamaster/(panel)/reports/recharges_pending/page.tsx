import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { config } from '@/lib/config';
import { query, value } from '@/lib/db';
import { int } from '@/lib/text';
import { dayStart, now, phpDate } from '@/lib/time';
import { USER_TYPE, type UserRow } from '@/lib/types';
import { PageTitle } from '@/components/PageTitle';
import { Pagination, pageParam } from '@/components/Pagination';
import { input, type Params } from '../_lib';

/** WhatsApp users whose plan expires within N days or has already expired (ReportController::rechargesPending). */
export default async function RechargesPendingPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAdmin();
  const sp = await searchParams;
  const raw = input(sp, 'days');
  const days = raw === undefined ? 7 : int(raw);
  const page = pageParam(sp.page);
  const perPage = config.site.pageSize;
  const limitTs = dayStart() + days * 86400;

  const where = 'u_dstatus = 0 AND u_type = $1 AND u_status = 1 AND u_valid_till <= $2';
  const [users, total] = await Promise.all([
    query<UserRow & { plan_name: string | null }>(
      `SELECT u.u_id, u.u_last_recharge, u.u_company_name, u.u_username, u.u_mobile_no, u.u_email_id, u.u_valid_till, p.mv_name AS plan_name
         FROM (SELECT * FROM js_user WHERE ${where} ORDER BY u_valid_till, u_id LIMIT $3 OFFSET $4) u
         LEFT JOIN js_master_value p ON p.mv_id = u.u_active_plan AND u.u_active_plan <> 0
        ORDER BY u.u_valid_till, u.u_id`,
      [USER_TYPE.WHATSAPP, limitTs, perPage, (page - 1) * perPage],
    ),
    value<number>(`SELECT COUNT(*)::int FROM js_user WHERE ${where}`, [USER_TYPE.WHATSAPP, limitTs]),
  ]);
  const t = now();

  return (
    <>
      <PageTitle title="Pending Recharges" home="/wamaster/dashboard" />
      <div className="card">
        <div className="card-header">
          <form method="get" className="d-flex gap-2 align-items-center">
            <label htmlFor="days" className="mb-0">Expiring within</label>
            <input type="number" min="0" className="form-control w-auto" id="days" name="days" defaultValue={days} />
            <span>days (or already expired)</span>
            <button className="btn btn-secondary">Apply</button>
          </form>
        </div>
        <div className="card-body table-responsive">
          <table className="table table-sm table-striped align-middle mb-0">
            <thead className="table-light"><tr><th>Last Recharge</th><th>Company</th><th>Username</th><th>Mobile</th><th>Email</th><th>Plan</th><th>Valid Till</th><th /></tr></thead>
            <tbody>
              {users.length ? users.map((u) => (
                <tr key={u.u_id}>
                  <td>{u.u_last_recharge ? phpDate('d-m-Y', u.u_last_recharge) : '—'}</td>
                  <td>{u.u_company_name}</td>
                  <td>{u.u_username}</td>
                  <td>{u.u_mobile_no}</td>
                  <td>{u.u_email_id}</td>
                  <td>{u.plan_name ?? ''}</td>
                  <td className={u.u_valid_till < t ? 'text-danger' : 'text-warning'}>{u.u_valid_till ? phpDate('d-m-Y', u.u_valid_till) : '—'}</td>
                  <td><Link href={`/wamaster/users/${u.u_id}`} className="btn btn-sm btn-soft-primary">Recharge</Link></td>
                </tr>
              )) : (
                <tr><td colSpan={8} className="text-center text-muted py-4">Nobody is due.</td></tr>
              )}
            </tbody>
          </table>
          <div className="mt-3"><Pagination path="/wamaster/reports/recharges_pending" params={sp} page={page} perPage={perPage} total={total ?? 0} /></div>
        </div>
      </div>
    </>
  );
}
