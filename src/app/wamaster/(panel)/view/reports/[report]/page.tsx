import { notFound } from "next/navigation";
import AdminShell from "@/components/admin/AdminShell";
import SelectAll from "@/components/admin/SelectAll";
import { Alert, Empty, PageTitle, Pagination, StatCard } from "@/components/admin/ui";
import { db } from "@/lib/db";
import { getAdmin } from "@/lib/admin/guard";
import { int, page, qs, str, withMonthDefault, type SearchParams } from "@/lib/admin/params";
import { WA_STATUS } from "@/lib/admin/constants";
import { phpDate, todayDmy } from "@/lib/admin/format";
import { messageError, messageSummary, REPORT_SELECT, REPORTS, reportOrderBy, reportWhere, sendReportCounters, type ReportKey } from "@/lib/admin/messages";
import { waUserList } from "@/lib/admin/users";
import { bulkMessageAction } from "../actions";

export const dynamic = "force-dynamic";

// wamaster/view/reports/{wa_send,wa_failed,wa_error,wa_system_error,wa_que,wa_in_process}.php
export default async function MessageReportPage({ params, searchParams }: { params: Promise<{ report: string }>; searchParams: Promise<SearchParams> }) {
  const { report } = await params;
  if (!(report in REPORTS)) notFound();
  const key = report as ReportKey;
  const r = REPORTS[key];
  const admin = await getAdmin({ superAdmin: r.superOnly });
  const sp = withMonthDefault(await searchParams);
  const pageSize = key === "wa_send" ? 500 : 100;
  const current = page(sp);
  const where = reportWhere(key, admin, sp);
  const userId = int(sp, "user_id");

  const [total, rows, users, counters, templates] = await Promise.all([
    db.js_message.count({ where }),
    db.js_message.findMany({ where, orderBy: reportOrderBy(key, sp), skip: (current - 1) * pageSize, take: pageSize, select: REPORT_SELECT }),
    waUserList(admin),
    r.full ? sendReportCounters(where) : null,
    !r.full && userId
      ? db.js_user_templates.findMany({ where: { ut_user_id: userId, ut_dstatus: 0 }, orderBy: { ut_id: "desc" }, select: { ut_id: true, ut_name: true } })
      : Promise.resolve([]),
  ]);
  const showInProcess = key === "wa_in_process";
  const colSpan = showInProcess ? 6 : key === "wa_que" ? 7 : 8;
  const back = `/wamaster/view/reports/${key}${qs(sp, { updated: undefined })}`;

  return (
    <AdminShell admin={admin} group="reports">
      <PageTitle title={r.title} />
      <Alert msg={str(sp, "updated") ? `${str(sp, "updated")} record(s) updated` : ""} />
      {counters && (
        <div className="row">
          <StatCard label="Total Send" value={counters.sent} />
          <StatCard label="Templates Send" value={counters.templates} />
          <StatCard label="Error" value={counters.error} />
          <StatCard label="In Que" value={counters.pending} />
        </div>
      )}
      {!counters && (
        <div className="row">
          <StatCard label="Total" value={total} />
        </div>
      )}

      <div className="card">
        <div className="card-body">
          <form method="get" className="row g-2 align-items-end mb-3">
            {r.full && (
              <div className="col-md-2">
                <label>Date Type</label>
                <select name="date_type" className="form-control" defaultValue={str(sp, "date_type") || "1"}>
                  <option value="1">Created On</option>
                  <option value="2">Updated On</option>
                  <option value="3">Processed On</option>
                </select>
              </div>
            )}
            <div className="col-md-2">
              <label>Date (d-m-Y or d-m-Y to d-m-Y)</label>
              <input type="text" className="form-control" data-provider="flatpickr" data-date-format="d-m-Y" data-range-date="true" name="wa_date" defaultValue={str(sp, "wa_date")} placeholder={todayDmy()} />
            </div>
            <div className="col-md-2">
              <label>User</label>
              <select name="user_id" className="form-control" defaultValue={userId ?? ""}>
                <option value="">All Users</option>
                {users.map((u) => (
                  <option key={u.u_id} value={u.u_id}>
                    {u.u_name} ({u.u_username})
                  </option>
                ))}
              </select>
            </div>
            {r.full ? (
              <>
                <div className="col-md-2">
                  <label>Type</label>
                  <select name="msg_type" className="form-control" defaultValue={str(sp, "msg_type") || "3"}>
                    <option value="3">All</option>
                    <option value="1">Templates</option>
                    <option value="2">Replies</option>
                    <option value="template">Template Only</option>
                    <option value="flow">Flow Only</option>
                    <option value="catalogue">Catalogue Only</option>
                    <option value="product_list">Product List Only</option>
                  </select>
                </div>
                <div className="col-md-1">
                  <label>Status</label>
                  <select name="st" className="form-control" defaultValue={str(sp, "st")}>
                    <option value="">All</option>
                    {Object.entries(WA_STATUS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-md-1">
                  <label>WA Status</label>
                  <select name="dst" className="form-control" defaultValue={str(sp, "dst")}>
                    <option value="">All</option>
                    <option value="read">Read</option>
                    <option value="sent">Sent</option>
                    <option value="delivered">Delivered</option>
                    <option value="failed">Failed</option>
                  </select>
                </div>
              </>
            ) : (
              <div className="col-md-2">
                <label>Template</label>
                <select name="template" className="form-control" defaultValue={str(sp, "template")}>
                  <option value="">Select Template</option>
                  <option value="-1">Non Template</option>
                  {templates.map((t) => (
                    <option key={t.ut_id} value={t.ut_name}>
                      {t.ut_name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="col-md-2">
              <label>Mobile No</label>
              <input type="text" className="form-control" name="mobile_no" defaultValue={str(sp, "mobile_no")} placeholder="Mobile No" />
            </div>
            <div className="col-auto d-flex gap-2">
              <button type="submit" className="btn btn-secondary">
                Search
              </button>
              {r.full && admin.isSuper && (
                <a className="btn btn-success" href={`/wamaster/view/reports/wa_send/export${qs(sp)}`}>
                  Export
                </a>
              )}
            </div>
          </form>

          <form action={bulkMessageAction}>
            <input type="hidden" name="report" value={key} />
            <input type="hidden" name="back" value={back} />
            <div className="table-responsive">
              <table className="table align-middle table-nowrap mb-0">
                <thead className="table-light">
                  <tr>
                    <th>
                      <SelectAll />
                      S. No.
                    </th>
                    <th>Username</th>
                    <th>{showInProcess ? "In Process On" : "Date"}</th>
                    {key === "wa_que" && <th>Type</th>}
                    <th>Mobile No</th>
                    <th>Content</th>
                    {!showInProcess && <th>Updated On</th>}
                    {key !== "wa_que" && !showInProcess && <th>WA Status</th>}
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && <Empty colSpan={colSpan} />}
                  {rows.map((m, i) => {
                    const failed = m.m_delivery_status === "failed";
                    const status =
                      m.m_status !== 3 ? WA_STATUS[m.m_status] ?? "" : m.m_delivery_status || m.m_message_id;
                    return (
                      <tr key={String(m.m_id)}>
                        <td>
                          <input type="checkbox" className="mids me-1" name="mids[]" value={String(m.m_id)} />
                          {(current - 1) * pageSize + i + 1}
                        </td>
                        <td>{m.js_user.u_username}</td>
                        <td>{phpDate("d M H:i:s", showInProcess ? m.m_in_process_on : m.m_created_on)}</td>
                        {key === "wa_que" && <td>{m.m_msg_type}</td>}
                        <td>{m.m_mobile_no}</td>
                        <td style={{ whiteSpace: "pre-wrap", maxWidth: 420 }}>
                          {messageSummary(m).slice(0, 100)}
                          {(m.m_image ?? "")
                            .split(",")
                            .filter(Boolean)
                            .map((u, k) => (
                              <div key={k}>
                                <a target="_blank" href={u}>
                                  View
                                </a>
                              </div>
                            ))}
                        </td>
                        {!showInProcess && <td>{phpDate("d-M-Y H:i:s", m.m_updated_on)}</td>}
                        {key !== "wa_que" && !showInProcess && <td>{status}</td>}
                        <td className={failed ? "text-danger" : ""} style={{ whiteSpace: "normal", maxWidth: 260 }}>
                          {failed ? messageError(m) : showInProcess || key === "wa_que" ? status : WA_STATUS[m.m_status]}
                        </td>
                      </tr>
                    );
                  })}
                  <Pagination total={total} pageSize={pageSize} current={current} sp={sp} colSpan={colSpan} />
                </tbody>
              </table>
            </div>
            {rows.length > 0 && (
              <div className="d-flex gap-2 mt-3" style={{ maxWidth: 360 }}>
                <select name="cstatus" className="form-control" required defaultValue="">
                  <option value="">Status</option>
                  {r.actions.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
                <input type="submit" className="btn btn-success" value="Change" />
              </div>
            )}
          </form>
        </div>
      </div>
    </AdminShell>
  );
}
