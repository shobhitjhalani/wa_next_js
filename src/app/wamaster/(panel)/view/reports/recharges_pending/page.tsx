import type { Prisma } from "@prisma/client";
import AdminShell from "@/components/admin/AdminShell";
import { Empty, PageTitle, Pagination } from "@/components/admin/ui";
import { db } from "@/lib/db";
import { getAdmin } from "@/lib/admin/guard";
import { int, page, str, type SearchParams } from "@/lib/admin/params";
import { dateRange, phpDate, ucfirst } from "@/lib/admin/format";
import { companyList } from "@/lib/admin/users";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 100;

function thisMonth() {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" })
    .formatToParts(new Date()).reduce<Record<string, string>>((a, x) => ((a[x.type] = x.value), a), {});
  const start = (m: number) => Math.floor(Date.UTC(+p.year, +p.month - 1 + m, 1) / 1000) - 5.5 * 3600;
  return { gte: start(0), lt: start(1) };
}

// wamaster/view/reports/recharges_pending.php — users whose plan ends this month (or in the chosen range)
export default async function RechargesDueReport({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const admin = await getAdmin({ superAdmin: true });
  const sp = await searchParams;
  const current = page(sp);
  const range = dateRange(str(sp, "wa_date"));
  const parentId = int(sp, "user_id");
  const where: Prisma.js_userWhereInput = {
    u_dstatus: 0,
    u_type: 2,
    u_valid_till: range ?? thisMonth(),
    ...(parentId ? { u_parent_id: parentId } : {}),
  };
  const [total, rows, companies] = await Promise.all([
    db.js_user.count({ where }),
    db.js_user.findMany({ where, orderBy: { u_valid_till: "asc" }, skip: (current - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    companyList(),
  ]);
  const plans = await db.js_master_value.findMany({ where: { mv_id: { in: rows.map((r) => BigInt(r.u_active_plan)) } }, select: { mv_id: true, mv_name: true } });
  const planOf = new Map(plans.map((p) => [Number(p.mv_id), p.mv_name]));
  const companyOf = new Map(companies.map((c) => [c.u_id, c.u_company_name || c.u_name || ""]));

  return (
    <AdminShell admin={admin} group="reports">
      <PageTitle title="WA Recharges Due" />
      <div className="card">
        <div className="card-body">
          <form method="get" className="row g-2 align-items-end mb-3">
            <div className="col-md-3">
              <label>Valid Till</label>
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
            <div className="col-auto">
              <button type="submit" className="btn btn-secondary">
                Search
              </button>
            </div>
          </form>
          <div className="table-responsive">
            <table className="table align-middle table-nowrap mb-0">
              <thead className="table-light">
                <tr>
                  <th>S. No.</th>
                  <th>Last Recharge On</th>
                  <th>Company Name</th>
                  <th>Username</th>
                  <th>Mobile No</th>
                  <th>Email ID</th>
                  <th>WA Plan</th>
                  <th>Valid Till</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <Empty colSpan={9} />}
                {rows.map((u, i) => (
                  <tr key={u.u_id}>
                    <td>{(current - 1) * PAGE_SIZE + i + 1}</td>
                    <td>{phpDate("d-m-Y", u.u_last_recharge)}</td>
                    <td>{ucfirst(companyOf.get(u.u_parent_id))}</td>
                    <td>{u.u_username}</td>
                    <td>{u.u_mobile_no}</td>
                    <td>{u.u_email_id}</td>
                    <td>{planOf.get(u.u_active_plan)}</td>
                    <td>{phpDate("d-m-Y", u.u_valid_till)}</td>
                    <td>
                      <a className="btn btn-sm btn-info" href={`/wamaster/view/user/recharge?ut=2&id=${u.u_id}`}>
                        Recharge
                      </a>
                    </td>
                  </tr>
                ))}
                <Pagination total={total} pageSize={PAGE_SIZE} current={current} sp={sp} colSpan={9} />
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
