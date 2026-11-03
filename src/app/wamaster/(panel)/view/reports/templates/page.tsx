import AdminShell from "@/components/admin/AdminShell";
import { Empty, PageTitle } from "@/components/admin/ui";
import { assignedMessageFilter, getAdmin } from "@/lib/admin/guard";
import { qs, str, withMonthDefault, type SearchParams } from "@/lib/admin/params";
import { templateSummary } from "@/lib/admin/templates";
import { numberFormat, ucfirst } from "@/lib/admin/format";
import { companyList, waUserList } from "@/lib/admin/users";

export const dynamic = "force-dynamic";

// wamaster/view/reports/templates.php
export default async function TemplatesReport({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const admin = await getAdmin();
  const sp = withMonthDefault(await searchParams);
  const [{ headings, rows }, users, companies] = await Promise.all([
    templateSummary(assignedMessageFilter(admin), sp),
    waUserList(admin),
    admin.isSuper ? companyList() : Promise.resolve([]),
  ]);
  const names = new Map(users.map((u) => [u.u_id, u.u_name ?? ""]));
  const grand: Record<string, number> = {};
  const totals = { send: 0, hit: 0, data: 0 };

  return (
    <AdminShell admin={admin} group="reports">
      <PageTitle title="WA Template Report" />
      <div className="card">
        <div className="card-body">
          <form method="get" className="row g-2 align-items-end mb-3">
            <div className="col-md-2">
              <label>Date Type</label>
              <select name="date_type" className="form-control" defaultValue={str(sp, "date_type") || "1"}>
                <option value="1">Created On</option>
                <option value="2">Updated On</option>
                <option value="3">Processed On</option>
              </select>
            </div>
            <div className="col-md-2">
              <label>Date</label>
              <input type="text" className="form-control" data-provider="flatpickr" data-date-format="d-m-Y" data-range-date="true" name="wa_date" defaultValue={str(sp, "wa_date")} />
            </div>
            <div className="col-md-3">
              <label>User</label>
              <select name="user_id" className="form-control" defaultValue={str(sp, "user_id")}>
                <option value="">All Users</option>
                {users.map((u) => (
                  <option key={u.u_id} value={u.u_id}>
                    {u.u_name}
                  </option>
                ))}
              </select>
            </div>
            {admin.isSuper && (
              <div className="col-md-3">
                <label>Company</label>
                <select name="parent_id" className="form-control" defaultValue={str(sp, "parent_id")}>
                  <option value="">All Companies</option>
                  {companies.map((c) => (
                    <option key={c.u_id} value={c.u_id}>
                      {c.u_company_name || c.u_name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="col-auto d-flex gap-2">
              <button type="submit" className="btn btn-secondary">
                Search
              </button>
              {admin.isSuper && (
                <a className="btn btn-success" href={`/wamaster/view/reports/templates/export${qs(sp)}`}>
                  Export
                </a>
              )}
            </div>
          </form>
          <div className="table-responsive">
            <table className="table align-middle table-nowrap mb-0">
              <thead className="table-light">
                <tr>
                  <th>S. No.</th>
                  <th>User</th>
                  <th>Template Name</th>
                  {headings.map((h) => (
                    <th key={h} className="text-end">
                      {h === "" ? "Not Send" : ucfirst(h)}
                    </th>
                  ))}
                  <th className="text-end">Total</th>
                  <th className="text-end">Total Hit</th>
                  <th className="text-end">Total Records</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <Empty colSpan={headings.length + 6} />}
                {rows.map((r, i) => {
                  let send = 0, hit = 0, all = 0;
                  return (
                    <tr key={`${r.userId}-${r.template}`}>
                      <td>{i + 1}</td>
                      <td>{names.get(r.userId) ?? r.userId}</td>
                      <td>{r.template}</td>
                      {headings.map((h) => {
                        const n = r.counts[h] ?? 0;
                        if (!["Que", "Incoming", "failed", "Error", "In Process"].includes(h)) send += n;
                        if (!["Que", "Incoming", "In Process", "Error"].includes(h)) hit += n;
                        if (h !== "Incoming") all += n;
                        grand[h] = (grand[h] ?? 0) + n;
                        return (
                          <td key={h} className="text-end">
                            {numberFormat(n)}
                          </td>
                        );
                      })}
                      {(() => {
                        totals.send += send;
                        totals.hit += hit;
                        totals.data += all;
                        return null;
                      })()}
                      <th className="text-end">{numberFormat(send)}</th>
                      <th className="text-end">{numberFormat(hit)}</th>
                      <th className="text-end">{numberFormat(all)}</th>
                    </tr>
                  );
                })}
                {rows.length > 0 && (
                  <tr>
                    <th colSpan={3}>Total</th>
                    {headings.map((h) => (
                      <th key={h} className="text-end">
                        {numberFormat(grand[h] ?? 0)}
                      </th>
                    ))}
                    <th className="text-end">{numberFormat(totals.send)}</th>
                    <th className="text-end">{numberFormat(totals.hit)}</th>
                    <th className="text-end">{numberFormat(totals.data)}</th>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
