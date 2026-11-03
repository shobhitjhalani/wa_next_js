import AdminShell from "@/components/admin/AdminShell";
import { Empty, PageTitle, Pagination } from "@/components/admin/ui";
import { db } from "@/lib/db";
import type { Admin } from "@/lib/admin/guard";
import { page, type SearchParams } from "@/lib/admin/params";
import { ucfirst } from "@/lib/admin/format";

const PAGE_SIZE = 100;

/** reports/users.php and reports/gs_users.php: active corporate (Google sheet) users. */
export default async function CorporateUsersReport({ admin, sp, detailed }: { admin: Admin; sp: SearchParams; detailed: boolean }) {
  const current = page(sp);
  const where = { u_type: 1, u_dstatus: 0, u_status: 1 };
  const [total, rows] = await Promise.all([
    db.js_user.count({ where }),
    db.js_user.findMany({ where, orderBy: { u_name: "asc" }, skip: (current - 1) * PAGE_SIZE, take: PAGE_SIZE }),
  ]);
  const cols = detailed ? 7 : 4;
  return (
    <AdminShell admin={admin} group="reports">
      <PageTitle title="Active Google Sheet Users" />
      <div className="card">
        <div className="card-body table-responsive">
          <table className="table align-middle table-nowrap mb-0">
            <thead className="table-light">
              <tr>
                <th>S.No</th>
                <th>User Code</th>
                <th>Company Name</th>
                {detailed ? (
                  <>
                    <th>Email ID</th>
                    <th>Mobile No</th>
                    <th>Google Sheet Email ID</th>
                    <th></th>
                  </>
                ) : (
                  <th>User Name</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <Empty colSpan={cols} />}
              {rows.map((u, i) => (
                <tr key={u.u_id}>
                  <td>{(current - 1) * PAGE_SIZE + i + 1}</td>
                  <td>{u.u_code}</td>
                  <td>{ucfirst(u.u_company_name || u.u_name)}</td>
                  {detailed ? (
                    <>
                      <td>{u.u_email_id}</td>
                      <td>{u.u_mobile_no}</td>
                      <td>{u.u_google_sheet_email}</td>
                      <td>
                        <a className="btn btn-sm btn-info" href={`/wamaster/view/user/view?ut=1&id=${u.u_id}`}>
                          <i className="ri-eye-line"></i>
                        </a>
                      </td>
                    </>
                  ) : (
                    <td>{u.u_username}</td>
                  )}
                </tr>
              ))}
              <Pagination total={total} pageSize={PAGE_SIZE} current={current} sp={sp} colSpan={cols} />
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  );
}
