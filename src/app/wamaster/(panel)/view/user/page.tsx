import type { Prisma } from "@prisma/client";
import AdminShell from "@/components/admin/AdminShell";
import { Empty, PageTitle, Pagination } from "@/components/admin/ui";
import ConfirmButton from "@/components/admin/ConfirmButton";
import { db } from "@/lib/db";
import { assignedUserFilter, getAdmin } from "@/lib/admin/guard";
import { hasRight } from "@/lib/admin/rights";
import { int, page, str, type SearchParams } from "@/lib/admin/params";
import { phpDate, ucfirst } from "@/lib/admin/format";
import { companyList, userTypeName } from "@/lib/admin/users";
import { deleteUserAction, setUserStatusAction } from "./actions";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 100;

// wamaster/view/user/index.php
export default async function UserListPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const admin = await getAdmin();
  const ut = int(sp, "ut") ?? 2;
  const title = await userTypeName(ut);
  const q = str(sp, "title");
  const parentId = int(sp, "parent_id");
  const mobile = str(sp, "cmobile");
  const current = page(sp);

  const where: Prisma.js_userWhereInput = {
    u_dstatus: 0,
    u_type: ut,
    ...assignedUserFilter(admin),
    ...(q
      ? {
          OR: ["u_name", "u_company_name", "u_code", "u_username"].map((f) => ({ [f]: { contains: q, mode: "insensitive" } })),
        }
      : {}),
    ...(parentId ? { u_parent_id: parentId } : {}),
    ...(mobile ? { u_mobile_no: { contains: mobile } } : {}),
  };
  const [total, users, companies, canAdd, canEdit, canDelete] = await Promise.all([
    db.js_user.count({ where }),
    db.js_user.findMany({ where, orderBy: { u_created_on: "desc" }, skip: (current - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    ut === 2 ? companyList() : Promise.resolve([]),
    hasRight(admin, "user", "Add"),
    hasRight(admin, "user", "Edit"),
    hasRight(admin, "user", "Delete"),
  ]);
  const companyOf = new Map(companies.map((c) => [c.u_id, c.u_company_name ?? ""]));
  const colSpan = ut === 2 ? 11 : 9;
  const back = `/wamaster/view/user?ut=${ut}`;

  return (
    <AdminShell admin={admin} group="user">
      <PageTitle title={title} />
      <div className="row">
        <div className="col-lg-12">
          <div className="card">
            <div className="card-header align-items-center d-flex">
              <h4 className="card-title mb-0 flex-grow-1">{title}</h4>
              {canAdd && (
                <a href={`/wamaster/view/user/add?ut=${ut}`} className="btn btn-primary">
                  Add New {title}
                </a>
              )}
            </div>
            <div className="card-body">
              <form method="get" className="row g-3 align-items-end mb-3">
                <input type="hidden" name="ut" value={ut} />
                {ut === 2 && (
                  <div className="col-md-4">
                    <label>Company Name:</label>
                    <select name="parent_id" className="form-control" defaultValue={parentId ?? ""}>
                      <option value="">Company Name</option>
                      {companies.map((c) => (
                        <option key={c.u_id} value={c.u_id}>
                          {c.u_company_name || c.u_name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="col-md-3">
                  <input type="text" className="form-control" name="title" defaultValue={q} placeholder="Title" />
                </div>
                <div className="col-md-2">
                  <input type="text" className="form-control" name="cmobile" defaultValue={mobile} placeholder="Mobile No" />
                </div>
                <div className="col-auto">
                  <button type="submit" className="btn btn-secondary">
                    Search
                  </button>
                </div>
              </form>
              <div className="table-responsive">
                <table className="table align-middle table-nowrap table-striped-columns mb-0">
                  <thead className="table-light">
                    <tr>
                      <th>S.No</th>
                      <th>Code</th>
                      <th>Register Date</th>
                      <th>Company Name</th>
                      <th>Name</th>
                      <th>Mobile No</th>
                      <th>Username</th>
                      <th>Status</th>
                      {ut === 2 && <th colSpan={2}>Valid Till</th>}
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.length === 0 && <Empty colSpan={colSpan} />}
                    {users.map((u, i) => {
                      const viewUrl = `/wamaster/view/user/view?ut=${ut}&id=${u.u_id}`;
                      const created = u.u_created_on || Math.floor(u.u_system_time.getTime() / 1000);
                      return (
                        <tr key={u.u_id}>
                          <td>
                            {(current - 1) * PAGE_SIZE + i + 1} - {u.u_id}
                          </td>
                          <td>
                            <a href={viewUrl}>{u.u_code}</a>
                          </td>
                          <td>{phpDate("d-M-Y", created)}</td>
                          <td>{ucfirst(ut === 2 && u.u_parent_id > 0 ? companyOf.get(u.u_parent_id) : u.u_company_name)}</td>
                          <td>{ucfirst(u.u_name)}</td>
                          <td>{u.u_mobile_no}</td>
                          <td>{ucfirst(u.u_username)}</td>
                          <td>
                            {u.u_status === 3 ? (
                              <span className="badge bg-danger">Expired</span>
                            ) : (
                              <form action={setUserStatusAction} className="d-inline">
                                <input type="hidden" name="id" value={u.u_id} />
                                <input type="hidden" name="ut" value={ut} />
                                <input type="hidden" name="status" value={u.u_status === 2 ? 1 : 2} />
                                <input type="hidden" name="back" value={back} />
                                <button type="submit" className="btn p-0 border-0" disabled={!canEdit}>
                                  {u.u_status === 2 ? <span className="badge bg-secondary">Inactive</span> : <span className="badge bg-success">Active</span>}
                                </button>
                              </form>
                            )}
                          </td>
                          {ut === 2 && (
                            <>
                              <td>{phpDate("d-m-Y", u.u_valid_till)}</td>
                              <td>
                                <a className="btn btn-sm btn-info" href={`/wamaster/view/user/recharge?ut=${ut}&id=${u.u_id}`}>
                                  Recharge
                                </a>
                              </td>
                            </>
                          )}
                          <td className="d-flex gap-1">
                            <a className="btn btn-sm btn-info" href={viewUrl} title="View">
                              <i className="ri-eye-line"></i>
                            </a>
                            {canEdit && (
                              <a className="btn btn-sm btn-secondary" href={`/wamaster/view/user/add?ut=${ut}&id=${u.u_id}`} title="Edit">
                                <i className="ri-edit-2-line"></i>
                              </a>
                            )}
                            {canDelete && (
                              <form action={deleteUserAction}>
                                <input type="hidden" name="id" value={u.u_id} />
                                <input type="hidden" name="ut" value={ut} />
                                <ConfirmButton className="btn btn-sm btn-danger" message="Are you sure to delete this detail" title="Delete">
                                  <i className="ri-delete-bin-line"></i>
                                </ConfirmButton>
                              </form>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    <Pagination total={total} pageSize={PAGE_SIZE} current={current} sp={sp} colSpan={colSpan} />
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
