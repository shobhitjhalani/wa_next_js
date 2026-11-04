import type { Metadata } from 'next';
import Link from 'next/link';
import { PageTitle } from '@/components/PageTitle';
import { Pagination, pageParam } from '@/components/Pagination';
import { DateRangeInput } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { config } from '@/lib/config';
import { query } from '@/lib/db';
import { sp } from '@/lib/http';
import { numberFormat } from '@/lib/text';
import { parseDateRange, phpDate } from '@/lib/time';
import type { RechargeRow } from '@/lib/types';

export const metadata: Metadata = { title: 'Recharge History' };

type Row = Pick<RechargeRow, 'ur_id' | 'ur_created_on' | 'ur_invoice_no' | 'ur_amount' | 'ur_gst_amount' | 'ur_received_amount' | 'ur_valid_till' | 'ur_payment_ref_no'>
  & { plan_name: string | null; total: number };

/** The user's recharges (User\PlanController::history, legacy recharge.php). */
export default async function RechargePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const params = await searchParams;
  const waDate = sp(params, 'wa_date');
  const range = parseDateRange(waDate);
  const page = pageParam(params.page);
  const perPage = config.site.pageSize;

  const args: unknown[] = [user.u_id, perPage, (page - 1) * perPage];
  let dateSql = '';
  if (range) {
    args.push(range[0], range[1]);
    dateSql = 'AND r.ur_created_on BETWEEN $4 AND $5';
  }
  // Page + total in one statement (js_user_recharge_user_idx)
  const rows = await query<Row>(
    `SELECT r.ur_id, r.ur_created_on, r.ur_invoice_no, r.ur_amount, r.ur_gst_amount, r.ur_received_amount, r.ur_valid_till,
            r.ur_payment_ref_no, mv.mv_name AS plan_name, COUNT(*) OVER ()::int AS total
       FROM js_user_recharge r
       LEFT JOIN js_master_value mv ON mv.mv_id = r.ur_plan_id
      WHERE r.ur_user_id = $1 AND r.ur_dstatus = 0 ${dateSql}
      ORDER BY r.ur_id DESC
      LIMIT $2 OFFSET $3`,
    args,
  );
  const total = rows[0]?.total ?? (page > 1
    ? (await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM js_user_recharge r WHERE r.ur_user_id = $1 AND r.ur_dstatus = 0 ${dateSql.replace('$4', '$2').replace('$5', '$3')}`,
      range ? [user.u_id, range[0], range[1]] : [user.u_id]))[0].n
    : 0);
  const firstItem = (page - 1) * perPage + 1;

  return (
    <>
      <PageTitle title="Recharge History" home="/dashboard" />
      <div className="card">
        <div className="card-header">
          <form method="get" className="row g-2 align-items-center filter-bar">
            <div className="col-md-3"><DateRangeInput name="wa_date" defaultValue={waDate} placeholder="Date range" /></div>
            <div className="col-auto"><button type="submit" className="btn btn-secondary">Search</button></div>
            {waDate && <div className="col-auto"><Link href="/recharge" className="btn btn-light">Clear</Link></div>}
          </form>
        </div>
        <div className="card-body">
          <div className="table-responsive">
            <table className="table align-middle table-nowrap table-striped mb-0">
              <thead className="table-light">
                <tr><th>#</th><th>Date</th><th>Invoice No</th><th>Plan</th><th className="text-end">Amount</th><th className="text-end">GST</th><th className="text-end">Paid</th><th>Valid Till</th><th>Reference</th></tr>
              </thead>
              <tbody>
                {rows.length ? rows.map((r, i) => (
                  <tr key={r.ur_id}>
                    <td>{firstItem + i}</td>
                    <td>{phpDate('d M Y', r.ur_created_on)}</td>
                    <td>{r.ur_invoice_no || '—'}</td>
                    <td>{r.plan_name}</td>
                    <td className="text-end">{numberFormat(r.ur_amount, 2)}</td>
                    <td className="text-end">{numberFormat(r.ur_gst_amount, 2)}</td>
                    <td className="text-end">{numberFormat(r.ur_received_amount, 2)}</td>
                    <td>{r.ur_valid_till ? phpDate('d M Y', r.ur_valid_till) : ''}</td>
                    <td className="small">{r.ur_payment_ref_no}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={9} className="text-center text-muted py-4">No recharges yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination path="/recharge" params={params} page={page} perPage={perPage} total={total} />
        </div>
      </div>
    </>
  );
}
