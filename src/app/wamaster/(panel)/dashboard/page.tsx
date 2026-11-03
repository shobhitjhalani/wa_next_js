import AdminShell from "@/components/admin/AdminShell";
import SummaryTable from "@/components/admin/SummaryTable";
import { Card, StatCard } from "@/components/admin/ui";
import { db } from "@/lib/db";
import { istParts } from "@/lib/config";
import { assignedUserFilter, getAdmin } from "@/lib/admin/guard";
import { dashboardStats, userSummary, usersByState } from "@/lib/admin/stats";
import { numberFormat, phpDate, ucfirst } from "@/lib/admin/format";

export const dynamic = "force-dynamic";

// wamaster/dashboard.php
export default async function AdminDashboardPage() {
  const admin = await getAdmin();
  const today = istParts().startOfDay;
  const queDate = today - 518_400;

  const [stats, states, summary, expired] = await Promise.all([
    admin.isSuper ? dashboardStats() : null,
    admin.isSuper ? usersByState() : [],
    userSummary({
      admin,
      sent: { m_in_process_on: { gte: today } },
      que: { m_status: 1, m_created_on: { gte: queDate } },
      inProcess: { m_status: 6, m_created_on: { gte: queDate } },
      error: { m_status: 3, m_message_id: "", m_created_date: today },
    }),
    db.js_user.findMany({
      where: { u_type: 2, u_dstatus: 0, u_wa_plan_status: 2, u_status: 1, u_valid_till: { gt: 0 }, ...assignedUserFilter(admin) },
      orderBy: [{ u_parent_id: "asc" }, { u_valid_till: "asc" }],
      select: { u_id: true, u_code: true, u_name: true, u_mobile_no: true, u_username: true, u_valid_till: true, u_parent_id: true },
    }),
  ]);
  const parents = await db.js_user.findMany({
    where: { u_id: { in: [...new Set(expired.map((u) => u.u_parent_id).filter((p) => p > 0))] } },
    select: { u_id: true, u_company_name: true },
  });
  const companyOf = new Map(parents.map((p) => [p.u_id, p.u_company_name ?? ""]));
  const money = (t: { amount: number; count: number }) => `${numberFormat(t.amount)} / ${t.count}`;

  return (
    <AdminShell admin={admin} group="">
      <div className="row mb-3 pb-1">
        <div className="col-12">
          <h4 className="fs-16 mb-1">Good Morning, {admin.name}!</h4>
          <p className="text-muted mb-0">Here&apos;s what&apos;s happening with your site today.</p>
        </div>
      </div>

      {stats && (
        <>
          <div className="row">
            <StatCard label="Total Msg Send Today" value={stats.sentToday} href="/wamaster/view/reports/wa_send" icon="bx bx-dollar-circle" />
            <StatCard label="In Que" value={stats.pending} href="/wamaster/view/reports/wa_que" icon="bx bx-shopping-bag" />
            <StatCard label="In Process" value={stats.inProcessRecent} href="/wamaster/view/reports/wa_in_process" icon="bx bx-user-circle" />
            <StatCard label="Active Users" value={stats.connected} href="/wamaster/view/user?ut=2" icon="bx bx-wallet" />
          </div>
          <div className="row">
            <div className="col-xl-8">
              <Card title="Revenue" bodyClass="p-0">
                <div className="row g-0 text-center">
                  {[
                    ["Total Collection", money(stats.year)],
                    ["Last Month", money(stats.last)],
                    ["This Month", money(stats.month)],
                    ["Pending Recharge", String(stats.pendingRecharge)],
                  ].map(([label, value]) => (
                    <div key={label} className="col-6 col-sm-3">
                      <div className="p-3 border border-dashed border-start-0">
                        <h5 className="mb-1">{value}</h5>
                        <p className="text-muted mb-0">{label}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="p-3 text-muted small">
                  Last message sent: {phpDate("M d, Y H:i", stats.lastSent) || "-"} · In process (all time): {stats.inProcessAll} · Pending {stats.pendingPercent}%
                </div>
              </Card>
            </div>
            <div className="col-xl-4">
              <Card title="User by State">
                {states.map((s) => (
                  <div key={s.state} className="mb-2">
                    <div className="d-flex justify-content-between">
                      <span>{s.state || "-"}</span>
                      <span>{s.count}</span>
                    </div>
                    <div className="progress progress-sm">
                      <div className="progress-bar bg-success" role="progressbar" style={{ width: `${s.percent}%` }} aria-valuenow={s.percent} aria-valuemin={0} aria-valuemax={100}></div>
                    </div>
                  </div>
                ))}
              </Card>
            </div>
          </div>
        </>
      )}

      {summary.rows.length > 0 && (
        <Card title="Today Summary">
          <SummaryTable headings={summary.headings} rows={summary.rows} />
        </Card>
      )}

      {expired.length > 0 && (
        <Card title="Plan Expired Users">
          <div className="table-responsive">
            <table className="table align-middle table-nowrap mb-0">
              <thead className="table-light">
                <tr>
                  <th>S.No</th>
                  <th>Code</th>
                  <th>Company Name</th>
                  <th>Name</th>
                  <th>Mobile No</th>
                  <th>Username</th>
                  <th>Valid Till</th>
                </tr>
              </thead>
              <tbody>
                {expired.map((u, i) => (
                  <tr key={u.u_id}>
                    <td>{i + 1}</td>
                    <td>
                      <a href={`/wamaster/view/user/view?ut=2&id=${u.u_id}`}>{u.u_code}</a>
                    </td>
                    <td>{ucfirst(companyOf.get(u.u_parent_id))}</td>
                    <td>
                      <a href={`/wamaster/view/user/view?ut=2&id=${u.u_id}`}>{ucfirst(u.u_name)}</a>
                    </td>
                    <td>{u.u_mobile_no}</td>
                    <td>{u.u_username}</td>
                    <td>{phpDate("d-M-Y", u.u_valid_till)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </AdminShell>
  );
}
