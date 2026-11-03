import type { Prisma } from "@prisma/client";
import AdminShell from "@/components/admin/AdminShell";
import { Empty, PageTitle, Pagination } from "@/components/admin/ui";
import { db } from "@/lib/db";
import { istParts } from "@/lib/config";
import { assignedUserFilter, getAdmin } from "@/lib/admin/guard";
import { int, page, str, type SearchParams } from "@/lib/admin/params";
import { numberFormat, phpDate, ucfirst } from "@/lib/admin/format";
import { companyList } from "@/lib/admin/users";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 100;

// wamaster/view/reports/wa_users.php — active WhatsApp users with message counts.
// PHP counted only the legacy m_msg_type = '1' / m_source = 2 rows (always 0 today);
// this counts all outgoing messages.
export default async function WaUsersReport({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const admin = await getAdmin();
  const sp = await searchParams;
  const current = page(sp);
  const code = str(sp, "wa_user_code");
  const parentId = int(sp, "wa_parent_id");
  const where: Prisma.js_userWhereInput = {
    u_type: 2,
    u_dstatus: 0,
    u_status: 1,
    ...assignedUserFilter(admin),
    ...(code ? { OR: [{ u_code: { contains: code, mode: "insensitive" } }, { u_username: { contains: code, mode: "insensitive" } }] } : {}),
    ...(parentId ? { u_parent_id: parentId } : {}),
  };
  const [total, users, companies] = await Promise.all([
    db.js_user.count({ where }),
    db.js_user.findMany({ where, orderBy: { u_id: "desc" }, skip: (current - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    companyList(),
  ]);
  const ids = users.map((u) => u.u_id);
  const today = istParts().startOfDay;
  const out = { m_user_id: { in: ids }, m_is_incoming: 2, m_dstatus: 0 };
  const [sentToday, sentAll, que] = await Promise.all([
    db.js_message.groupBy({ by: ["m_user_id"], where: { ...out, m_status: 3, m_updated_on: { gte: today } }, _count: { m_id: true } }),
    db.js_message.groupBy({ by: ["m_user_id"], where: { ...out, m_status: 3 }, _count: { m_id: true } }),
    db.js_message.groupBy({ by: ["m_user_id"], where: { ...out, m_status: 1, m_created_on: { gte: today - 259_200 } }, _count: { m_id: true } }),
  ]);
  const m = (g: { m_user_id: number; _count: { m_id: number } }[]) => new Map(g.map((x) => [x.m_user_id, x._count.m_id]));
  const [today_, all, queued] = [m(sentToday), m(sentAll), m(que)];
  const companyOf = new Map(companies.map((c) => [c.u_id, c.u_company_name || c.u_name || ""]));

  return (
    <AdminShell admin={admin} group="reports">
      <PageTitle title="Active WA Users" />
      <div className="card">
        <div className="card-body">
          <form method="get" className="row g-2 align-items-end mb-3">
            <div className="col-md-3">
              <input type="text" className="form-control" name="wa_user_code" defaultValue={code} placeholder="User Code / Username" />
            </div>
            <div className="col-md-3">
              <select name="wa_parent_id" className="form-control" defaultValue={parentId ?? ""}>
                <option value="">Company Name</option>
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
                  <th>S.No</th>
                  <th>User Code</th>
                  <th>User Name</th>
                  <th>Company Name</th>
                  <th>Valid Till</th>
                  <th>WA Connected No.</th>
                  <th className="text-end">Send Today</th>
                  <th className="text-end">Total Que</th>
                  <th className="text-end">Total Msg Send</th>
                  <th className="text-end">Last Msg Send</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 && <Empty colSpan={10} />}
                {users.map((u, i) => (
                  <tr key={u.u_id}>
                    <td>{(current - 1) * PAGE_SIZE + i + 1}</td>
                    <td>
                      <a href={`/wamaster/view/user/view?ut=2&id=${u.u_id}`}>{u.u_code}</a>
                    </td>
                    <td>{u.u_username}</td>
                    <td>{ucfirst(companyOf.get(u.u_parent_id))}</td>
                    <td>{phpDate("d-m-Y", u.u_valid_till)}</td>
                    <td>{u.u_wa_no}</td>
                    <td className="text-end">{numberFormat(today_.get(u.u_id) ?? 0)}</td>
                    <td className="text-end">{numberFormat(queued.get(u.u_id) ?? 0)}</td>
                    <td className="text-end">{numberFormat(all.get(u.u_id) ?? 0)}</td>
                    <td className="text-end">{phpDate("d-m-Y H:i", u.u_last_wa_send)}</td>
                  </tr>
                ))}
                <Pagination total={total} pageSize={PAGE_SIZE} current={current} sp={sp} colSpan={10} />
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
