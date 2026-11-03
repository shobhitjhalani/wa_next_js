import type { Prisma } from "@prisma/client";
import AdminShell from "@/components/admin/AdminShell";
import { Empty, PageTitle, Pagination, StatCard } from "@/components/admin/ui";
import { db } from "@/lib/db";
import { getAdmin } from "@/lib/admin/guard";
import { int, page, str, type SearchParams } from "@/lib/admin/params";
import { ACTIVE_INACTIVE, MV_TYPE } from "@/lib/admin/constants";
import { dateRange, ucfirst } from "@/lib/admin/format";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 100;

// wamaster/view/reports/google_sheets.php
export default async function GoogleSheetsReport({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const admin = await getAdmin({ superAdmin: true });
  const sp = await searchParams;
  const current = page(sp);
  const range = dateRange(str(sp, "wa_date"));
  const userId = int(sp, "user_id");
  const sheet = str(sp, "sheet_id");
  const st = int(sp, "st");
  const where: Prisma.js_user_active_sheetsWhereInput = {
    us_dstatus: 0,
    ...(range ? { us_created_on: range } : {}),
    ...(userId ? { us_user_id: userId } : {}),
    ...(sheet ? { us_sheet_id: { contains: sheet } } : {}),
    ...(st ? { us_sheet_type: st } : {}),
  };
  const [total, active, rows, types, corporates] = await Promise.all([
    db.js_user_active_sheets.count({ where }),
    db.js_user_active_sheets.count({ where: { ...where, us_status: 1 } }),
    db.js_user_active_sheets.findMany({ where, orderBy: { us_id: "desc" }, skip: (current - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db.js_master_value.findMany({ where: { mv_type: MV_TYPE.SheetType }, orderBy: { mv_name: "asc" }, select: { mv_code: true, mv_name: true } }),
    db.js_user.findMany({ where: { u_type: 1, u_dstatus: 0 }, orderBy: { u_name: "asc" }, select: { u_id: true, u_name: true, u_code: true, u_company_name: true } }),
  ]);
  const emails = await db.js_user_emails.findMany({ where: { ue_id: { in: rows.map((r) => r.us_user_email_id) } }, select: { ue_id: true, ue_email_id: true } });
  const emailOf = new Map(emails.map((e) => [e.ue_id, e.ue_email_id]));
  const typeOf = new Map(types.map((t) => [t.mv_code, t.mv_name]));
  const userOf = new Map(corporates.map((u) => [u.u_id, u]));

  return (
    <AdminShell admin={admin} group="reports">
      <PageTitle title="Active Google Sheets" />
      <div className="row">
        <StatCard label="Active Sheets" value={active} />
        <StatCard label="Total Sheets" value={total} />
      </div>
      <div className="card">
        <div className="card-body">
          <form method="get" className="row g-2 align-items-end mb-3">
            <div className="col-md-2">
              <label>Date</label>
              <input type="text" className="form-control" data-provider="flatpickr" data-date-format="d-m-Y" data-range-date="true" name="wa_date" defaultValue={str(sp, "wa_date")} />
            </div>
            <div className="col-md-3">
              <label>User</label>
              <select name="user_id" className="form-control" defaultValue={userId ?? ""}>
                <option value="">All</option>
                {corporates.map((u) => (
                  <option key={u.u_id} value={u.u_id}>
                    {u.u_company_name || u.u_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-3">
              <label>Sheet Type</label>
              <select name="st" className="form-control" defaultValue={st ?? ""}>
                <option value="">All</option>
                {types.map((t) => (
                  <option key={t.mv_code} value={t.mv_code ?? ""}>
                    {t.mv_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-2">
              <label>Sheet ID</label>
              <input type="text" className="form-control" name="sheet_id" defaultValue={sheet} />
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
                  <th>Sheet ID</th>
                  <th>Sheet Type</th>
                  <th>WA Code</th>
                  <th>Company Name</th>
                  <th>User Email ID</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <Empty colSpan={8} />}
                {rows.map((s, i) => {
                  const u = userOf.get(s.us_user_id);
                  return (
                    <tr key={s.us_id}>
                      <td>{(current - 1) * PAGE_SIZE + i + 1}</td>
                      <td>
                        <a href={`https://docs.google.com/spreadsheets/d/${s.us_sheet_id}`} target="_blank" rel="noreferrer">
                          {s.us_sheet_id}
                        </a>
                      </td>
                      <td>{typeOf.get(String(s.us_sheet_type))}</td>
                      <td>{u?.u_code}</td>
                      <td>{ucfirst(u?.u_company_name || u?.u_name)}</td>
                      <td>{emailOf.get(s.us_user_email_id)}</td>
                      <td>{ACTIVE_INACTIVE[s.us_status]}</td>
                      <td>
                        <a className="btn btn-sm btn-info" href={`/wamaster/view/user/view?ut=1&id=${s.us_user_id}`}>
                          <i className="ri-eye-line"></i>
                        </a>
                      </td>
                    </tr>
                  );
                })}
                <Pagination total={total} pageSize={PAGE_SIZE} current={current} sp={sp} colSpan={8} />
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
