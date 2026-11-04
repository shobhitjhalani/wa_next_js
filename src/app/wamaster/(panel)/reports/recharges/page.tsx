import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { config } from '@/lib/config';
import { one, query } from '@/lib/db';
import { masterOptions } from '@/lib/models';
import { numberFormat } from '@/lib/text';
import { monthStart, phpDate } from '@/lib/time';
import type { RechargeRow } from '@/lib/types';
import { PageTitle } from '@/components/PageTitle';
import { Pagination, pageParam } from '@/components/Pagination';
import { DateRangeInput } from '@/components/ui';
import { dateRange, filled, input, intParam, waUsers, type Params } from '../_lib';

type Row = RechargeRow & { u_username: string | null; u_company_name: string | null; u_name: string | null; plan_name: string | null; has_user: boolean };

/** Recharges of the financial year (ReportController::recharges). */
export default async function RechargesPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAdmin();
  const sp = await searchParams;
  const page = pageParam(sp.page);
  const perPage = config.site.pageSize;
  const year = config.site.fYear;
  const range = dateRange(input(sp, 'wa_date') ?? '');
  const mStart = monthStart();
  const prev = new Date(mStart * 1000);
  prev.setMonth(prev.getMonth() - 1);
  const lastMonthStart = monthStart(Math.floor(prev.getTime() / 1000));
  const userId = filled(sp, 'user_id') ? intParam(sp, 'user_id') : null;

  const base = 'r.ur_dstatus = 0 AND r.ur_year = $1 AND ($2::int IS NULL OR r.ur_user_id = $2)';
  const listArgs: unknown[] = [year, userId, range?.[0] ?? null, range?.[1] ?? null];
  const listWhere = `${base} AND ($3::int IS NULL OR r.ur_created_on BETWEEN $3 AND $4)`;

  const [recharges, total, sums, allUsers, gateways] = await Promise.all([
    query<Row>(
      `SELECT r.*, u.u_username, u.u_company_name, u.u_name, u.u_id IS NOT NULL AS has_user, p.mv_name AS plan_name
         FROM (SELECT r.* FROM js_user_recharge r WHERE ${listWhere} ORDER BY r.ur_id DESC LIMIT $5 OFFSET $6) r
         LEFT JOIN js_user u ON u.u_id = r.ur_user_id
         LEFT JOIN js_master_value p ON p.mv_id = r.ur_plan_id
        ORDER BY r.ur_id DESC`,
      [...listArgs, perPage, (page - 1) * perPage],
    ),
    one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM js_user_recharge r WHERE ${listWhere}`, listArgs),
    one<{ yt: number; yn: number; mt: number; mn: number; lt: number; ln: number }>(
      `SELECT COALESCE(SUM(ur_amount), 0) AS yt, COUNT(*)::int AS yn,
              COALESCE(SUM(ur_amount) FILTER (WHERE ur_created_on >= $3), 0) AS mt, COUNT(*) FILTER (WHERE ur_created_on >= $3)::int AS mn,
              COALESCE(SUM(ur_amount) FILTER (WHERE ur_created_on BETWEEN $4 AND $3 - 1), 0) AS lt,
              COUNT(*) FILTER (WHERE ur_created_on BETWEEN $4 AND $3 - 1)::int AS ln
         FROM js_user_recharge r WHERE ${base} AND ur_generate_invoice = 1`,
      [year, userId, mStart, lastMonthStart],
    ),
    waUsers(),
    masterOptions(config.masters.paymentGateway),
  ]);
  const gatewayName = new Map(gateways.map((g) => [Number(g.value), g.label]));
  const cards: [string, number, number][] = [
    [`Total (${year})`, sums?.yt ?? 0, sums?.yn ?? 0],
    ['This Month', sums?.mt ?? 0, sums?.mn ?? 0],
    ['Last Month', sums?.lt ?? 0, sums?.ln ?? 0],
  ];

  return (
    <>
      <PageTitle title="Recharges" home="/wamaster/dashboard" />
      <div className="row">
        {cards.map(([label, amount, n]) => (
          <div key={label} className="col-md-4"><div className="card"><div className="card-body">
            <p className="text-muted text-uppercase mb-1">{label}</p>
            <h4 className="mb-0">Rs. {numberFormat(amount, 2)} <span className="fs-13 text-muted">({n})</span></h4>
          </div></div></div>
        ))}
      </div>
      <div className="card">
        <div className="card-header">
          <form method="get" className="row g-2 align-items-center filter-bar">
            <div className="col-md-3"><DateRangeInput name="wa_date" defaultValue={input(sp, 'wa_date') ?? ''} placeholder="Date range" /></div>
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
          <table className="table table-sm table-striped align-middle mb-0">
            <thead className="table-light"><tr><th>Recharge On</th><th>Company</th><th>Username</th><th>Plan</th><th className="text-end">Amount</th><th className="text-end">Invoice Amt</th><th className="text-end">Received</th><th>Mode</th><th>Ref</th><th>Invoice</th></tr></thead>
            <tbody>
              {recharges.length ? recharges.map((r) => (
                <tr key={r.ur_id}>
                  <td>{phpDate('d-m-Y', r.ur_created_on)}</td>
                  <td>{r.u_company_name || r.u_name}</td>
                  <td>{r.has_user && <Link href={`/wamaster/users/${r.ur_user_id}`}>{r.u_username}</Link>}</td>
                  <td>{r.plan_name}</td>
                  <td className="text-end">{numberFormat(r.ur_amount, 2)}</td>
                  <td className="text-end">{numberFormat(Number(r.ur_amount) + Number(r.ur_gst_amount), 2)}</td>
                  <td className="text-end">{numberFormat(r.ur_received_amount, 2)}</td>
                  <td>{gatewayName.get(Number(r.ur_payment_source)) ?? (Number(r.ur_created_from) === 1 ? 'Online' : '—')}</td>
                  <td className="small">{r.ur_payment_ref_no}</td>
                  <td>{Number(r.ur_generate_invoice) === 1 ? 'Yes' : 'No'}</td>
                </tr>
              )) : (
                <tr><td colSpan={10} className="text-center text-muted py-4">No recharges.</td></tr>
              )}
            </tbody>
          </table>
          <div className="mt-3"><Pagination path="/wamaster/reports/recharges" params={sp} page={page} perPage={perPage} total={total?.n ?? 0} /></div>
        </div>
      </div>
    </>
  );
}
