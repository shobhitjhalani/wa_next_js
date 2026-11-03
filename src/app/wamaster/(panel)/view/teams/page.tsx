import AdminShell from "@/components/admin/AdminShell";
import ConfirmButton from "@/components/admin/ConfirmButton";
import { Empty, PageTitle, Pagination } from "@/components/admin/ui";
import { db } from "@/lib/db";
import { getAdmin } from "@/lib/admin/guard";
import { page, str, type SearchParams } from "@/lib/admin/params";
import { todayDmy } from "@/lib/admin/format";
import { teamMemberLeftAction } from "@/lib/admin/team-actions";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;
const TYPE: Record<number, string> = { 1: "Team Member", 4: "Super Admin" };

// wamaster/view/teams/index.php
export default async function TeamsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const admin = await getAdmin({ superAdmin: true });
  const sp = await searchParams;
  const title = str(sp, "title");
  const current = page(sp);
  const where = {
    emp_dstatus: 0,
    ...(title ? { OR: [{ emp_name: { contains: title, mode: "insensitive" as const } }, { emp_username: { contains: title, mode: "insensitive" as const } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    db.js_employee.count({ where }),
    db.js_employee.findMany({ where, orderBy: { emp_name: "asc" }, skip: (current - 1) * PAGE_SIZE, take: PAGE_SIZE }),
  ]);

  return (
    <AdminShell admin={admin} group="teams">
      <PageTitle title="Team Members" />
      <div className="card">
        <div className="card-header align-items-center d-flex">
          <h4 className="card-title mb-0 flex-grow-1">Team Members</h4>
          <a href="/wamaster/view/teams/add" className="btn btn-primary">
            Add New Team Member
          </a>
        </div>
        <div className="card-body">
          <form method="get" className="row g-2 mb-3">
            <div className="col-md-4">
              <input type="text" className="form-control" name="title" defaultValue={title} placeholder="Title" />
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
                  <th>Code</th>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Mobile</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th className="input-sm">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <Empty colSpan={7} />}
                {rows.map((e) => (
                  <tr key={e.emp_id}>
                    <td>
                      <a href={`/wamaster/view/teams/view?id=${e.emp_id}`}>{e.emp_code}</a>
                    </td>
                    <td>{e.emp_name}</td>
                    <td>{e.emp_username}</td>
                    <td>{e.emp_mobile}</td>
                    <td>{TYPE[e.emp_m_type] ?? e.emp_m_type}</td>
                    <td>{e.emp_is_left ? <span className="badge bg-danger">Left</span> : e.emp_status === 1 ? <span className="badge bg-success">Active</span> : <span className="badge bg-secondary">Inactive</span>}</td>
                    <td className="d-flex gap-1">
                      <a className="btn btn-sm btn-info" href={`/wamaster/view/teams/view?id=${e.emp_id}`}>
                        <i className="ri-eye-line"></i>
                      </a>
                      <a className="btn btn-sm btn-secondary" href={`/wamaster/view/teams/add?id=${e.emp_id}`}>
                        <i className="ri-edit-2-line"></i>
                      </a>
                      {e.emp_is_left === 0 && e.emp_id !== admin.empId && (
                        <form action={teamMemberLeftAction}>
                          <input type="hidden" name="id" value={e.emp_id} />
                          <input type="hidden" name="txtdol" value={todayDmy()} />
                          <ConfirmButton className="btn btn-sm btn-danger" message={`Mark ${e.emp_name ?? ""} as left? They will no longer be able to log in.`}>
                            Left
                          </ConfirmButton>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
                <Pagination total={total} pageSize={PAGE_SIZE} current={current} sp={sp} colSpan={7} />
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
