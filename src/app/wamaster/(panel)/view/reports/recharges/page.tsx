import type { Prisma } from "@prisma/client";
import AdminShell from "@/components/admin/AdminShell";
import { Empty, PageTitle, Pagination, StatCard } from "@/components/admin/ui";
import { db } from "@/lib/db";
import { getAdmin } from "@/lib/admin/guard";
import { int, page, str, type SearchParams } from "@/lib/admin/params";
import { F_YEAR } from "@/lib/admin/constants";
import { dateRange, numberFormat, phpDate, ucfirst } from "@/lib/admin/format";
import { companyList } from "@/lib/admin/users";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 100;

function monthStart(offset: number) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" })
    .formatToParts(new Date()).reduce<Record<string, string>>((a, x) => ((a[x.type] = x.value), a), {});
  return Math.floor(Date.UTC(+p.year, +p.month - 1 + offset, 1) / 1000) - 5.5 * 3600;
}

// wamaster/view/reports/recharges.php
export default async function RechargesReport({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const admin = await getAdmin({ superAdmin: true });
  const sp = await searchParams;
  const current = page(sp);
  // PHP defaulted the invoice filter to "Yes" (1).
  const invoice = "invoice" in sp ? str(sp, "invoice") : "1";
  const parentId = int(sp, "user_id");
  const range = dateRange(str(sp, "wa_date"));

  const filter: Prisma.js_user_rechargeWhereInput = {
    ur_dstatus: 0,
    ur_year: F_YEAR,
    ...(range ? { ur_created_on: range } : {}),
    ...(invoice ? { ur_generate_invoice: Number(invoice) } : {}),
  };
  const userIds = parentId ? (await db.js_user.findMany({ where: { u_parent_id: parentId }, select: { u_id: true } })).map((u) => u.u_id) : null;
  const where: Prisma.js_user_rechargeWhereInput = { ...filter, ...(userIds ? { ur_user_id: { in: userIds } } : {}) };

  const sum = async (extra: Prisma.js_user_rechargeWhereInput) => {
    const r = await db.js_user_recharge.aggregate({ where: { ...where, ur_generate_invoice: 1, ...extra }, _sum: { ur_amount: true }, _count: { ur_id: true } });
    return `${numberFormat(Number(r._sum.ur_amount ?? 0))} / ${r._count.ur_id}`;
  };

  const [total, rows, companies, year, month, last] = await Promise.all([
    db.js_user_recharge.count({ where }),
    db.js_user_recharge.findMany({ where, orderBy: { ur_id: "desc" }, skip: (current - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    companyList(),
    sum({}),
    sum({ ur_created_on: { gte: monthStart(0) } }),
    sum({ ur_created_on: { gte: monthStart(-1), lte: monthStart(0) } }),
  ]);
  const [users, plans] = await Promise.all([
    db.js_user.findMany({ where: { u_id: { in: rows.map((r) => r.ur_user_id) } }, select: { u_id: true, u_username: true, u_parent_id: true } }),
    db.js_master_value.findMany({ where: { mv_id: { in: rows.map((r) => BigInt(r.ur_plan_id)) } }, select: { mv_id: true, mv_name: true } }),
  ]);
  const userOf = new Map(users.map((u) => [u.u_id, u]));
  const planOf = new Map(plans.map((p) => [Number(p.mv_id), p.mv_name]));
  const companyOf = new Map(companies.map((c) => [c.u_id, c.u_company_name || c.u_name || ""]));

  return (
    <AdminShell admin={admin} group="reports">
      <PageTitle title="WA Recharges" />
      <div className="row">
        <StatCard label="This Year" value={year} />
        <StatCard label="Last Month" value={last} />
        <StatCard label="This Month" value={month} />
        <StatCard label="Recharges" value={total} />
      </div>
      <div className="card">
        <div className="card-body">
          <form method="get" className="row g-2 align-items-end mb-3">
            <div className="col-md-3">
              <label>Date</label>
              <input type="text" className="form-control" data-provider="flatpickr" data-date-format="d-m-Y" data-range-date="true" name="wa_date" defaultValue={str(sp, "wa_date")} />
            </div>
            <div className="col-md-3">
              <label>Company</label>
              <select name="user_id" className="form-control" defaultValue={parentId ?? ""}>
                <option value="">All</option>
                {companies.map((c) => (
                  <option key={c.u_id} value={c.u_id}>
                    {c.u_company_name || c.u_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-2">
              <label>Generate Invoice</label>
              <select name="invoice" className="form-control" defaultValue={invoice}>
                <option value="">All</option>
                <option value="1">Yes</option>
                <option value="2">No</option>
              </select>
            </div>
            <div className="col-auto">
              <button type="submit" className="btn btn-secondary">
                Search
              </button>
              {/* Full page loads throughout the admin: the theme's app.js binds the sidebar once per load. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a className="btn btn-light ms-2" href="/wamaster/view/reports/recharges_pending">
                Recharges Due
              </a>
            </div>
          </form>
          <div className="table-responsive">
            <table className="table align-middle table-nowrap mb-0">
              <thead className="table-light">
                <tr>
                  <th>S. No.</th>
                  <th>Recharge On</th>
                  <th>Company Name</th>
                  <th>Username</th>
                  <th>WA Plan</th>
                  <th>Amount</th>
                  <th>Invoice Amount</th>
                  <th>Received Amount</th>
                  <th>Payment Ref. No.</th>
                  <th>Generate Invoice</th>
                  <th>Invoice</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <Empty colSpan={11} />}
                {rows.map((r, i) => {
                  const u = userOf.get(r.ur_user_id);
                  const amount = Number(r.ur_amount);
                  const gst = Number(r.ur_gst_amount);
                  return (
                    <tr key={r.ur_id}>
                      <td>{(current - 1) * PAGE_SIZE + i + 1}</td>
                      <td>{phpDate("d-m-Y", r.ur_created_on)}</td>
                      <td>{ucfirst(companyOf.get(u?.u_parent_id ?? 0))}</td>
                      <td>
                        <a href={`/wamaster/view/user/view?ut=2&id=${r.ur_user_id}`}>{u?.u_username}</a>
                      </td>
                      <td>{planOf.get(r.ur_plan_id)}</td>
                      <td>{numberFormat(amount, 2)}</td>
                      <td>{numberFormat(amount + gst, 2)}</td>
                      <td>{numberFormat(Number(r.ur_received_amount), 2)}</td>
                      <td>{r.ur_payment_ref_no}</td>
                      <td>{r.ur_generate_invoice === 1 ? "Yes" : "No"}</td>
                      <td>{r.ur_invoice_no}</td>
                    </tr>
                  );
                })}
                <Pagination total={total} pageSize={PAGE_SIZE} current={current} sp={sp} colSpan={11} />
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
