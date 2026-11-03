import { redirect } from "next/navigation";
import AdminShell from "@/components/admin/AdminShell";
import ConfirmButton from "@/components/admin/ConfirmButton";
import { Alert, Card, PageTitle, Pagination } from "@/components/admin/ui";
import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { getAdmin } from "@/lib/admin/guard";
import { int, page, str, type SearchParams } from "@/lib/admin/params";
import { ACTIVE_INACTIVE, MV_TYPE } from "@/lib/admin/constants";
import { phpDate, unescapeHtml } from "@/lib/admin/format";
import { companyDetails, findUserFor, masterName, userTypeName } from "@/lib/admin/users";
import { generateExtractorKeyAction, googleItemAction, registerWaAction } from "../actions";

export const dynamic = "force-dynamic";
const yesNo = (v: number) => (v === 1 ? "Yes" : "No");

function Field({ label, children, col = "col-md-3" }: { label: string; children: React.ReactNode; col?: string }) {
  return (
    <div className={`${col} mb-3`}>
      <label style={{ wordBreak: "break-all" }}>
        {label} <br />
        <b>{children}</b>
      </label>
    </div>
  );
}

function ItemForm({ uid, ut, kind, item, op, status, label, css, confirm }: { uid: number; ut: number; kind: string; item: number; op: string; status?: number; label: React.ReactNode; css: string; confirm: string }) {
  return (
    <form action={googleItemAction} className="d-inline">
      <input type="hidden" name="uid" value={uid} />
      <input type="hidden" name="ut" value={ut} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="item" value={item} />
      <input type="hidden" name="op" value={op} />
      {status !== undefined && <input type="hidden" name="status" value={status} />}
      <ConfirmButton className={css} message={confirm}>
        {label}
      </ConfirmButton>
    </form>
  );
}

// wamaster/view/user/view.php (+ gs_view.php for corporate users, wa_view.php for WhatsApp users)
export default async function UserViewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const admin = await getAdmin();
  const ut = int(sp, "ut") ?? 2;
  const id = int(sp, "id") ?? 0;
  const user = await findUserFor(admin, id, ut);
  if (!user) redirect(`/wamaster/view/user?ut=${ut}`);

  const [title, company] = await Promise.all([userTypeName(ut), companyDetails(user)]);
  const stateName = await masterName(company.state);

  return (
    <AdminShell admin={admin} group="user">
      <PageTitle title={title} />
      <Alert msg={str(sp, "wh") ? "User Successfully Saved" : str(sp, "recharged") ? "Recharge Sucessully Done" : ""} />
      <Card title={user.u_name}>
        <div className="row">
          <Field label="Name:">{user.u_name}</Field>
          <Field label="Company Name:">{company.company}</Field>
          <Field label="Company GSTIN No:">{company.gst}</Field>
          <Field label="State:">{stateName}</Field>
          <Field label="Mobile No:">{user.u_mobile_no}</Field>
          <Field label="Email:">{user.u_email_id}</Field>
          <Field label="Username:">{user.u_username}</Field>
          <Field label="User Status:">{user.u_status === 2 ? "Inactive" : "Active"}</Field>
          {ut === 2 && <Field label="WA Valid Till:">{phpDate("d-m-Y", user.u_valid_till)}</Field>}
          {ut === 1 && (
            <>
              <Field label="Google Sheet Status:">{user.u_google_sheet === 2 ? "No" : "Yes"}</Field>
              <Field label="Google Sheet Email:">{user.u_google_sheet_email}</Field>
            </>
          )}
        </div>
        {ut === 2 && (
          <div className="row">
            <Field label="WA Phone No:">{user.u_wa_no}</Field>
            <Field label="WA Phone ID:">{user.u_wa_phone_id}</Field>
            <Field label="WABA ID:">{user.u_wa_b_id}</Field>
            <Field label="Business ID:">{user.u_business_id}</Field>
            <Field label="Access Code:">{user.u_code}</Field>
            <Field label="Total Limit / Daily Limit:">
              {user.u_msg_limit} / {user.u_daily_limit}
            </Field>
            <Field label="MM Lite:">{yesNo(user.u_is_new_no)}</Field>
            <Field label="Send Flow:">{yesNo(user.u_send_wa)}</Field>
            <Field label="Catalogue:">{yesNo(user.u_wa_enable_catalogue)}</Field>
            {/* PHP printed the catalogue flag here by mistake. */}
            <Field label="AI:">{yesNo(user.u_enable_ai)}</Field>
            <Field label="Incoming Read URL:" col="col-md-6">
              {user.u_wa_incoming_url}
            </Field>
          </div>
        )}
        <div className="d-flex gap-2 flex-wrap">
          <a href={`/wamaster/view/user?ut=${ut}`} className="btn btn-light btn-label">
            Back <i className="ri-arrow-left-line label-icon align-middle fs-16 me-2"></i>
          </a>
          {ut === 2 && (
            <form action={registerWaAction}>
              <input type="hidden" name="id" value={user.u_id} />
              <input type="hidden" name="ut" value={ut} />
              <ConfirmButton className="btn btn-secondary btn-label" message="Register this number with WhatsApp again?">
                <i className="ri-whatsapp-fill label-icon align-middle fs-16 ms-2"></i> Refresh User
              </ConfirmButton>
            </form>
          )}
          <a href={`/wamaster/view/user/recharge?ut=${ut}&id=${user.u_id}`} className="btn btn-primary btn-label">
            <i className="ri-file-fill label-icon align-middle fs-16 ms-2"></i> Recharge
          </a>
          <a href={`/wamaster/view/user/add?ut=${ut}&id=${user.u_id}`} className="btn btn-danger btn-label">
            <i className="ri-pencil-fill label-icon align-middle fs-16 ms-2"></i> Edit
          </a>
        </div>
      </Card>

      {ut === 1 ? <GoogleTabs userId={user.u_id} ut={ut} googleSheet={user.u_google_sheet === 1} /> : <WaTemplates userId={user.u_id} sp={sp} />}
    </AdminShell>
  );
}

async function GoogleTabs({ userId, ut, googleSheet }: { userId: number; ut: number; googleSheet: boolean }) {
  const [emails, sheetCounts, sheets, keys, sheetTypes] = await Promise.all([
    db.js_user_emails.findMany({ where: { ue_dstatus: 0, ue_user_id: userId }, orderBy: { ue_id: "desc" } }),
    db.js_user_active_sheets.groupBy({ by: ["us_sheet_type"], where: { us_dstatus: 0, us_user_id: userId }, _count: { us_id: true } }),
    db.js_user_active_sheets.findMany({ where: { us_dstatus: 0, us_user_id: userId }, orderBy: { us_id: "desc" } }),
    db.js_user_data_extractor_keys.findMany({ where: { dek_dstatus: 0, dek_user_id: userId }, orderBy: { dek_id: "desc" } }),
    db.js_master_value.findMany({ where: { mv_type: MV_TYPE.SheetType }, select: { mv_code: true, mv_name: true } }),
  ]);
  const typeName = new Map(sheetTypes.map((t) => [t.mv_code, t.mv_name]));
  const activeByEmail = new Map<number, number>();
  for (const s of sheets) if (s.us_status === 1) activeByEmail.set(s.us_user_email_id, (activeByEmail.get(s.us_user_email_id) ?? 0) + 1);

  return (
    <div className="card">
      <div className="card-body">
        <ul className="nav nav-tabs mb-3" role="tablist">
          {[
            ["gmail_summary", "GMail Accounts"],
            ["google_sheets_summary", "Google Sheets (Summary)"],
            ["google_sheets", "Google Sheets"],
            ["google_extractor", "Google Extractor"],
          ].map(([id, label], i) => (
            <li className="nav-item" key={id}>
              <a className={`nav-link ${i === 0 ? "active" : ""}`} data-bs-toggle="tab" href={`#${id}`}>
                {label}
              </a>
            </li>
          ))}
        </ul>
        <div className="tab-content">
          <div className="tab-pane fade active show" id="gmail_summary" role="tabpanel">
            {googleSheet && (
              <a href={`/wamaster/view/user/emails?ut=${ut}&id=${userId}`} className="btn btn-primary mb-2">
                Add New Email
              </a>
            )}
            <table className="table table-bordered">
              <thead>
                <tr>
                  <th>S.No.</th>
                  <th>Created On</th>
                  <th>Email ID</th>
                  <th>No of Sheets</th>
                  <th>No of Sheets (Active)</th>
                  <th></th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {emails.map((e, i) => (
                  <tr key={e.ue_id}>
                    <td>{i + 1}</td>
                    <td>{phpDate("d-m-Y H:i:s", e.ue_created_on)}</td>
                    <td>{e.ue_email_id}</td>
                    <td>{e.ue_sheet_limit > 0 ? e.ue_sheet_limit : ""}</td>
                    <td>{activeByEmail.get(e.ue_id) ?? 0}</td>
                    <td>
                      <ItemForm uid={userId} ut={ut} kind="email" item={e.ue_id} op="status" status={e.ue_status === 2 ? 1 : 2}
                        label={e.ue_status === 2 ? "Inactive" : "Active"} css={`btn btn-sm ${e.ue_status === 2 ? "btn-secondary" : "btn-success"}`}
                        confirm={`Are you sure to ${e.ue_status === 2 ? "Active" : "InActive"} this record`} />
                    </td>
                    <td>
                      <ItemForm uid={userId} ut={ut} kind="email" item={e.ue_id} op="delete" label="Delete" css="btn btn-sm btn-danger" confirm="Are you sure to delete this record" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="tab-pane fade" id="google_sheets_summary" role="tabpanel">
            <table className="table table-bordered">
              <thead>
                <tr>
                  <th>S.No.</th>
                  <th>Sheet Type</th>
                  <th>Total Count</th>
                </tr>
              </thead>
              <tbody>
                {sheetCounts.map((c, i) => (
                  <tr key={c.us_sheet_type}>
                    <td>{i + 1}</td>
                    <td>{typeName.get(String(c.us_sheet_type))}</td>
                    <td>{c._count.us_id}</td>
                  </tr>
                ))}
                <tr>
                  <th colSpan={2}>Total</th>
                  <th>{sheetCounts.reduce((a, c) => a + c._count.us_id, 0)}</th>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="tab-pane fade" id="google_sheets" role="tabpanel">
            <table className="table table-bordered">
              <thead>
                <tr>
                  <th>S.No.</th>
                  <th>Created On</th>
                  <th>Valid Till</th>
                  <th>Sheet Type</th>
                  <th>Sheet ID</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {sheets.map((s, i) => (
                  <tr key={s.us_id}>
                    <td>{i + 1}</td>
                    <td>{phpDate("d-m-Y", s.us_created_on)}</td>
                    <td>{phpDate("d-m-Y", s.us_valid_till)}</td>
                    <td>{typeName.get(String(s.us_sheet_type))}</td>
                    <td>{s.us_sheet_id}</td>
                    <td>
                      <ItemForm uid={userId} ut={ut} kind="sheet" item={s.us_id} op="status" status={s.us_status === 2 ? 1 : 2}
                        label={ACTIVE_INACTIVE[s.us_status] ?? ""} css="btn btn-sm btn-link" confirm="Are you sure?" />
                    </td>
                    <td>
                      <ItemForm uid={userId} ut={ut} kind="sheet" item={s.us_id} op="delete" label="Delete" css="btn btn-danger btn-sm" confirm="Are you sure?" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="tab-pane fade" id="google_extractor" role="tabpanel">
            <form action={generateExtractorKeyAction} className="mb-2">
              <input type="hidden" name="id" value={userId} />
              <input type="hidden" name="ut" value={ut} />
              <button type="submit" className="btn btn-primary">
                Generate New Key
              </button>
            </form>
            <table className="table table-bordered">
              <thead>
                <tr>
                  <th>S.No.</th>
                  <th>Created On</th>
                  <th>Key</th>
                  <th>Last Login</th>
                  <th colSpan={2}></th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k, i) => (
                  <tr key={k.dek_id}>
                    <td>{i + 1}</td>
                    <td>{phpDate("d-m-Y", k.dek_created_on)}</td>
                    <td>{k.dek_key}</td>
                    <td>{phpDate("d-m-Y", k.dek_last_login ?? 0)}</td>
                    <td>
                      {k.dek_is_login === 1 && (
                        <ItemForm uid={userId} ut={ut} kind="key" item={k.dek_id} op="logout" label="Logout" css="btn btn-danger btn-sm" confirm="Logout this key?" />
                      )}
                    </td>
                    <td>
                      <ItemForm uid={userId} ut={ut} kind="key" item={k.dek_id} op="delete" label="Delete" css="btn btn-danger btn-sm" confirm="Are you sure to delete this key?" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

async function WaTemplates({ userId, sp }: { userId: number; sp: SearchParams }) {
  const pageSize = 50;
  const current = page(sp);
  const where = { ut_user_id: userId, ut_dstatus: 0 };
  const [total, templates] = await Promise.all([
    db.js_user_templates.count({ where }),
    db.js_user_templates.findMany({ where, orderBy: { ut_id: "desc" }, skip: (current - 1) * pageSize, take: pageSize }),
  ]);
  return (
    <Card title="WA Templates">
      <div className="table-responsive">
        <table className="table table-bordered align-middle">
          <thead>
            <tr>
              <th>S. No.</th>
              <th>Created Date</th>
              <th>Template Name</th>
              <th>Content</th>
              <th>Attachment</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t, i) => (
              <tr key={t.ut_id}>
                <td>{(current - 1) * pageSize + i + 1}</td>
                <td>{phpDate("d M y H:i", t.ut_created_on)}</td>
                <td>{t.ut_name}</td>
                <td style={{ whiteSpace: "pre-wrap", maxWidth: 500 }}>{unescapeHtml(t.ut_message)}</td>
                <td>
                  {(t.ut_file ?? "")
                    .split(",")
                    .filter(Boolean)
                    .map((f) => (
                      <div key={f}>
                        <a href={`${config.mediaUrl}watemplate/${f}`} target="_blank">
                          {f}
                        </a>
                      </div>
                    ))}
                </td>
                <td>{ACTIVE_INACTIVE[t.ut_status] ?? ""}</td>
              </tr>
            ))}
            <Pagination total={total} pageSize={pageSize} current={current} sp={sp} colSpan={6} />
          </tbody>
        </table>
      </div>
    </Card>
  );
}
