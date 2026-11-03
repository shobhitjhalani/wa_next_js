import type { Prisma } from "@prisma/client";
import AdminShell from "@/components/admin/AdminShell";
import SummaryTable from "@/components/admin/SummaryTable";
import { Card, PageTitle, StatCard } from "@/components/admin/ui";
import { db } from "@/lib/db";
import { config, istParts } from "@/lib/config";
import { getAdmin } from "@/lib/admin/guard";
import { int, str, type SearchParams } from "@/lib/admin/params";
import { dateRange, todayDmy } from "@/lib/admin/format";
import { userSummary } from "@/lib/admin/stats";
import { waUserList } from "@/lib/admin/users";

export const dynamic = "force-dynamic";

// wamaster/view/reports/summary.php — results only after a search, like PHP.
export default async function SummaryReport({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const admin = await getAdmin({ superAdmin: true });
  const sp = await searchParams;
  const users = await waUserList(admin);
  const searched = str(sp, "s") === "1";

  let result: Awaited<ReturnType<typeof userSummary>> | null = null;
  let counters: { sent: number; inProcess: number; pending: number } | null = null;
  if (searched) {
    const range = dateRange(str(sp, "wa_date"));
    const con: Prisma.js_messageWhereInput = {
      ...(range ? { m_created_date: range } : {}),
      ...(str(sp, "mobile_no") ? { m_mobile_no: str(sp, "mobile_no") } : {}),
      ...(int(sp, "user_id") ? { m_user_id: int(sp, "user_id") } : {}),
    };
    const queDate = istParts().startOfDay - config.wa.queTime;
    const out = { m_is_incoming: 2, m_dstatus: 0, ...con };
    const [summary, sent, inProcess, pending] = await Promise.all([
      userSummary({
        admin,
        sent: con,
        que: { m_status: { in: [1, 6] }, m_created_on: { gte: queDate } },
        incoming: con,
        error: { m_status: 3, m_message_id: "", ...con },
      }),
      db.js_message.count({ where: { ...out, m_status: 3 } }),
      db.js_message.count({ where: { ...out, m_status: 6 } }),
      db.js_message.count({ where: { ...out, m_status: 1 } }),
    ]);
    result = summary;
    counters = { sent, inProcess, pending };
  }

  return (
    <AdminShell admin={admin} group="reports">
      <PageTitle title="WA Report (Summary)" />
      {counters && (
        <div className="row">
          <StatCard label="Total Send" value={counters.sent} />
          <StatCard label="In Process" value={counters.inProcess} />
          <StatCard label="In Que" value={counters.pending} />
        </div>
      )}
      <Card>
        <form method="get" className="row g-2 align-items-end mb-3">
          <input type="hidden" name="s" value="1" />
          <div className="col-md-3">
            <label>Date</label>
            <input type="text" className="form-control" data-provider="flatpickr" data-date-format="d-m-Y" data-range-date="true" name="wa_date" defaultValue={str(sp, "wa_date") || todayDmy()} />
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
          <div className="col-md-2">
            <label>Mobile No</label>
            <input type="text" className="form-control" name="mobile_no" defaultValue={str(sp, "mobile_no")} />
          </div>
          <div className="col-auto">
            <button type="submit" className="btn btn-secondary">
              Search
            </button>
          </div>
        </form>
        {result && (result.rows.length ? <SummaryTable headings={result.headings} rows={result.rows} /> : <p className="text-muted">No Record Found</p>)}
      </Card>
    </AdminShell>
  );
}
