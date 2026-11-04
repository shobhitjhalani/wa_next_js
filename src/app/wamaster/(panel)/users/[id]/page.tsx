import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { config } from '@/lib/config';
import { one, query, value } from '@/lib/db';
import { masterCodeOptions, masterName, masterOptions } from '@/lib/models';
import { listPlans } from '@/lib/services/plans';
import { numberFormat } from '@/lib/text';
import { dayStart, monthStart, phpDate } from '@/lib/time';
import { USER_TYPE, type UserRow } from '@/lib/types';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { PageTitle } from '@/components/PageTitle';
import { ConfirmButton } from '@/components/ui';
import {
  addEmail, deleteEmail, deleteKey, deleteSheet, generateKey, logoutKey, rechargeUser, registerUserNumber,
  syncUserTemplates, toggleEmail, toggleSheet,
} from '../actions';

const yes = (v: unknown) => (Number(v) === 1 ? 'Yes' : 'No');
const date = (ts: unknown, fmt = 'd-m-Y') => (Number(ts) ? phpDate(fmt, Number(ts)) : '');

/**
 * Message counts for today and this month (UserController::waSummary) in one
 * grouped scan of this user's month: sent split by delivery status, plus
 * queue, processing, API errors and incoming.
 */
async function waSummary(userId: number): Promise<Record<string, Record<string, number>>> {
  const today = dayStart();
  const [rows, que] = await Promise.all([
    query<{ inc: number; st: number; ds: string; n_m: number; noid_m: number; n_t: number; noid_t: number }>(
      `SELECT m_is_incoming AS inc, m_status AS st, COALESCE(m_delivery_status, '') AS ds,
              COUNT(*)::int AS n_m,
              COUNT(*) FILTER (WHERE COALESCE(m_message_id, '') = '')::int AS noid_m,
              COUNT(*) FILTER (WHERE m_created_on >= $3)::int AS n_t,
              COUNT(*) FILTER (WHERE m_created_on >= $3 AND COALESCE(m_message_id, '') = '')::int AS noid_t
         FROM js_message WHERE m_user_id = $1 AND m_dstatus = 0 AND m_created_on >= $2
        GROUP BY 1, 2, 3`,
      [userId, monthStart(), today],
    ),
    // Queue is not tied to the period: everything still waiting inside the queue window
    value<number>(
      'SELECT COUNT(*)::int FROM js_message WHERE m_user_id = $1 AND m_is_incoming = 2 AND m_dstatus = 0 AND m_status = 1 AND m_created_on >= $2',
      [userId, today - config.queTime],
    ),
  ]);
  const build = (n: 'n_t' | 'n_m', noid: 'noid_t' | 'noid_m') => {
    const row: Record<string, number> = { Sent: 0, Delivered: 0, Read: 0, Failed: 0, Que: 0, Processing: 0, Error: 0, Incoming: 0 };
    for (const r of rows) {
      if (!r[n]) continue;
      if (Number(r.inc) === 1) row.Incoming += r[n];
      else if (Number(r.st) === 3) {
        row.Error += r[noid];
        const s = r.ds || 'sent';
        const col = s.charAt(0).toUpperCase() + s.slice(1);
        row[col] = (row[col] ?? 0) + r[n] - r[noid];
      } else if (Number(r.st) === 6) row.Processing += r[n];
    }
    return row;
  };
  const summary: Record<string, Record<string, number>> = { Today: build('n_t', 'noid_t'), 'This Month': build('n_m', 'noid_m') };
  // Same columns in every period, even when an unusual delivery status shows up in only one
  const blank: Record<string, number> = {};
  for (const row of Object.values(summary)) for (const k of Object.keys(row)) blank[k] = 0;
  for (const [k, row] of Object.entries(summary)) summary[k] = { ...blank, ...row, Que: que ?? 0 };
  return summary;
}

/** User details (Admin\UserController::show + admin/users/show.blade.php). */
export default async function UserShowPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id: rawId } = await params;
  if (!/^\d{1,9}$/.test(rawId)) notFound();
  const id = Number(rawId);
  const user = await one<UserRow & { parent_name: string | null; parent_company: string | null; parent_id: number | null }>(
    `SELECT u.*, p.u_id AS parent_id, p.u_name AS parent_name, p.u_company_name AS parent_company
       FROM js_user u LEFT JOIN js_user p ON p.u_id = u.u_parent_id AND u.u_parent_id > 0
      WHERE u.u_id = $1 AND u.u_dstatus = 0`,
    [id],
  );
  if (!user) notFound();
  const isWa = Number(user.u_type) === USER_TYPE.WHATSAPP;

  const [stateName, summary, recharges, templates, plans, gateways, children, emails, sheets, sheetTypes, keys] = await Promise.all([
    masterName(user.u_state),
    isWa ? waSummary(id) : Promise.resolve({} as Record<string, Record<string, number>>),
    isWa
      ? query<{ ur_id: number; ur_created_on: number; plan_name: string | null; ur_amount: number; ur_received_amount: number; ur_valid_till: number; ur_created_from: number; ur_payment_ref_no: string | null }>(
        `SELECT r.ur_id, r.ur_created_on, mv.mv_name AS plan_name, r.ur_amount, r.ur_received_amount, r.ur_valid_till, r.ur_created_from, r.ur_payment_ref_no
           FROM js_user_recharge r LEFT JOIN js_master_value mv ON mv.mv_id = r.ur_plan_id
          WHERE r.ur_user_id = $1 AND r.ur_dstatus = 0 ORDER BY r.ur_id DESC`, [id])
      : Promise.resolve([]),
    isWa
      ? query<{ ut_id: number; ut_name: string; ut_template_category: string | null; ut_template_type: string; ut_language: string | null; ut_status: number }>(
        `SELECT ut_id, ut_name, ut_template_category, ut_template_type, ut_language, ut_status
           FROM js_user_templates WHERE ut_user_id = $1 AND ut_dstatus = 0 ORDER BY ut_id DESC`, [id])
      : Promise.resolve([]),
    isWa ? listPlans(true) : Promise.resolve([]),
    isWa ? masterOptions(config.masters.paymentGateway) : Promise.resolve([]),
    !isWa ? query<{ u_id: number; u_username: string | null }>('SELECT u_id, u_username FROM js_user WHERE u_parent_id = $1 AND u_dstatus = 0 ORDER BY u_id', [id]) : Promise.resolve([]),
    !isWa
      ? query<{ ue_id: number; ue_email_id: string | null; ue_sheet_limit: number; ue_status: number }>(
        'SELECT ue_id, ue_email_id, ue_sheet_limit, ue_status FROM js_user_emails WHERE ue_user_id = $1 AND ue_dstatus = 0 ORDER BY ue_id', [id])
      : Promise.resolve([]),
    !isWa
      ? query<{ us_id: number; us_sheet_id: string | null; us_sheet_type: number; us_created_on: number; us_valid_till: number; us_status: number }>(
        'SELECT us_id, us_sheet_id, us_sheet_type, us_created_on, us_valid_till, us_status FROM js_user_active_sheets WHERE us_user_id = $1 AND us_dstatus = 0 ORDER BY us_id DESC', [id])
      : Promise.resolve([]),
    !isWa ? masterCodeOptions(config.masters.sheetType) : Promise.resolve([]),
    !isWa
      ? query<{ dek_id: number; dek_key: string | null; dek_valid_till: number | null; dek_is_login: number; dek_last_login: number | null }>(
        'SELECT dek_id, dek_key, dek_valid_till, dek_is_login, dek_last_login FROM js_user_data_extractor_keys WHERE dek_user_id = $1 AND dek_dstatus = 0 ORDER BY dek_id', [id])
      : Promise.resolve([]),
  ]);

  const typeName = new Map(sheetTypes.map((o) => [String(o.value), o.label]));
  const sheetName = (t: number) => typeName.get(String(t)) ?? String(t);
  const sheetGroups = new Map<number, { active: number; total: number }>();
  for (const s of sheets) {
    const g = sheetGroups.get(s.us_sheet_type) ?? { active: 0, total: 0 };
    g.total++;
    if (Number(s.us_status) === 1) g.active++;
    sheetGroups.set(s.us_sheet_type, g);
  }
  const activeSheets = sheets.filter((s) => Number(s.us_status) === 1).length;
  const summaryCols = Object.keys(Object.values(summary)[0] ?? {});

  return (
    <>
      <PageTitle title={user.u_name ?? ''} home="/wamaster/dashboard" />
      <div className="d-flex flex-wrap gap-2 mb-3">
        <Link href={`/wamaster/users/${id}/edit`} className="btn btn-primary"><i className="ri-pencil-line" /> Edit</Link>
        {isWa && (
          <>
            <form action={syncUserTemplates.bind(null, id)}><button className="btn btn-soft-primary"><i className="ri-refresh-line" /> Sync Templates</button></form>
            {user.u_wa_phone_id && (
              <form action={registerUserNumber.bind(null, id)}>
                <ConfirmButton message="Register this number with the Cloud API and subscribe the app?" className="btn btn-soft-secondary"><i className="ri-shield-check-line" /> Register Number</ConfirmButton>
              </form>
            )}
          </>
        )}
        <Link href={`/wamaster/users?ut=${user.u_type}`} className="btn btn-light ms-auto">Back to list</Link>
      </div>

      <div className="row">
        <div className="col-xl-4">
          <div className="card">
            <div className="card-header"><h5 className="card-title mb-0">Details</h5></div>
            <div className="card-body">
              <dl className="row small mb-0">
                <dt className="col-5">Code</dt><dd className="col-7">{user.u_code}</dd>
                <dt className="col-5">Company</dt><dd className="col-7">{user.u_company_name}</dd>
                <dt className="col-5">GSTIN</dt><dd className="col-7">{user.u_company_gst_no}</dd>
                <dt className="col-5">State</dt><dd className="col-7">{stateName}</dd>
                <dt className="col-5">Mobile</dt><dd className="col-7">{user.u_mobile_no}</dd>
                <dt className="col-5">Email</dt><dd className="col-7">{user.u_email_id}</dd>
                <dt className="col-5">Username</dt><dd className="col-7">{user.u_username}</dd>
                <dt className="col-5">Status</dt><dd className="col-7">{Number(user.u_status) === 1 ? 'Active' : 'Inactive'}</dd>
                {user.parent_id ? (
                  <><dt className="col-5">Parent</dt><dd className="col-7"><Link href={`/wamaster/users/${user.parent_id}`}>{user.parent_company || user.parent_name}</Link></dd></>
                ) : null}
                {isWa && (
                  <>
                    <dt className="col-5">Valid Till</dt>
                    <dd className={`col-7 ${Number(user.u_wa_plan_status) === 1 ? '' : 'text-danger'}`}>{date(user.u_valid_till) || '—'} ({Number(user.u_wa_plan_status) === 1 ? 'Active' : 'Expired'})</dd>
                    <dt className="col-5">WA Phone No</dt><dd className="col-7">{user.u_wa_no}</dd>
                    <dt className="col-5">WA Phone ID</dt><dd className="col-7">{user.u_wa_phone_id}</dd>
                    <dt className="col-5">WABA ID</dt><dd className="col-7">{user.u_wa_b_id}</dd>
                    <dt className="col-5">Business ID</dt><dd className="col-7">{user.u_business_id}</dd>
                    <dt className="col-5">API Access Key</dt><dd className="col-7"><code>{user.u_access_code}</code></dd>
                    <dt className="col-5">Limit total/daily</dt><dd className="col-7">{user.u_msg_limit} / {user.u_daily_limit}</dd>
                    <dt className="col-5">MM Lite</dt><dd className="col-7">{yes(user.u_is_new_no)}</dd>
                    <dt className="col-5">Catalogue</dt><dd className="col-7">{yes(user.u_wa_enable_catalogue)}</dd>
                    <dt className="col-5">AI</dt><dd className="col-7">{yes(user.u_enable_ai)}</dd>
                    <dt className="col-5">Coexistence</dt><dd className="col-7">{yes(user.u_wa_coexistence)}</dd>
                    <dt className="col-5">Incoming URL</dt><dd className="col-7 text-break">{user.u_wa_incoming_url}</dd>
                  </>
                )}
              </dl>
            </div>
          </div>

          {isWa && (
            <div className="card">
              <div className="card-header"><h5 className="card-title mb-0">Recharge</h5></div>
              <div className="card-body">
                <ActionForm action={rechargeUser.bind(null, id)} confirm="Apply this recharge?" resetOnSuccess>
                  <div className="mb-2">
                    <label className="form-label" htmlFor="plan_id">WA Plan</label>
                    <select className="form-select" id="plan_id" name="plan_id" required>
                      {plans.map((p) => (
                        <option key={p.mv_id} value={p.mv_id}>{p.mv_name} — {parseInt(String(p.mv_value || '0'), 10) || 0} days — Rs. {numberFormat(p.mv_value_decimal, 2)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="row g-2 mb-2">
                    <div className="col-6"><label className="form-label" htmlFor="payment_amount">Amount Received</label><input type="number" step="0.01" min="0" className="form-control" id="payment_amount" name="payment_amount" /></div>
                    <div className="col-6">
                      <label className="form-label" htmlFor="payment_source">Payment Mode</label>
                      <select className="form-select" id="payment_source" name="payment_source">
                        <option value="0">—</option>
                        {gateways.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="mb-2"><label className="form-label" htmlFor="payment_ref_no">Reference No</label><input className="form-control" id="payment_ref_no" name="payment_ref_no" /></div>
                  <div className="mb-2"><label className="form-label" htmlFor="remark">Remark</label><input className="form-control" id="remark" name="remark" /></div>
                  <div className="form-check form-switch"><input className="form-check-input" type="checkbox" id="generate_invoice" name="generate_invoice" value="1" defaultChecked /><label className="form-check-label" htmlFor="generate_invoice">Generate Invoice</label></div>
                  <div className="form-check form-switch mb-3"><input className="form-check-input" type="checkbox" id="payment_received" name="payment_received" value="1" defaultChecked /><label className="form-check-label" htmlFor="payment_received">Payment Received</label></div>
                  <SubmitButton className="btn btn-success w-100">Recharge</SubmitButton>
                </ActionForm>
              </div>
            </div>
          )}
        </div>

        <div className="col-xl-8">
          {isWa ? (
            <>
              <div className="card">
                <div className="card-header"><h5 className="card-title mb-0">WhatsApp Summary</h5></div>
                <div className="card-body table-responsive">
                  <table className="table table-sm table-bordered align-middle text-end mb-0">
                    <thead className="table-light">
                      <tr><th className="text-start">Period</th>{summaryCols.map((c) => <th key={c}>{c}</th>)}</tr>
                    </thead>
                    <tbody>
                      {Object.entries(summary).map(([period, row]) => (
                        <tr key={period}><th className="text-start">{period}</th>{summaryCols.map((c) => <td key={c}>{numberFormat(row[c])}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-muted small mt-2 mb-0">Que counts everything still waiting in the queue window. Error is a send rejected by the WhatsApp API.</p>
                </div>
              </div>
              <div className="card">
                <div className="card-header"><h5 className="card-title mb-0">Recharge History</h5></div>
                <div className="card-body table-responsive">
                  <table className="table table-sm table-striped align-middle mb-0">
                    <thead className="table-light"><tr><th>Date</th><th>Plan</th><th className="text-end">Amount</th><th className="text-end">Received</th><th>Valid Till</th><th>By</th><th>Ref</th></tr></thead>
                    <tbody>
                      {recharges.length ? recharges.map((r) => (
                        <tr key={r.ur_id}>
                          <td>{phpDate('d-m-Y', Number(r.ur_created_on))}</td>
                          <td>{r.plan_name}</td>
                          <td className="text-end">{numberFormat(r.ur_amount, 2)}</td>
                          <td className="text-end">{numberFormat(r.ur_received_amount, 2)}</td>
                          <td>{date(r.ur_valid_till)}</td>
                          <td>{Number(r.ur_created_from) === 2 ? 'Staff' : 'Online'}</td>
                          <td className="small">{r.ur_payment_ref_no}</td>
                        </tr>
                      )) : (
                        <tr><td colSpan={7} className="text-muted text-center">No recharges.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="card">
                <div className="card-header"><h5 className="card-title mb-0">Templates ({templates.length})</h5></div>
                <div className="card-body table-responsive" style={{ maxHeight: '420px' }}>
                  <table className="table table-sm table-striped align-middle mb-0">
                    <thead className="table-light"><tr><th>Name</th><th>Category</th><th>Type</th><th>Language</th><th>Status</th></tr></thead>
                    <tbody>
                      {templates.length ? templates.map((t) => (
                        <tr key={t.ut_id}>
                          <td>{t.ut_name}</td>
                          <td>{t.ut_template_category}</td>
                          <td>{t.ut_template_type}</td>
                          <td>{t.ut_language}</td>
                          <td>{Number(t.ut_status) === 1 ? 'Active' : 'Inactive'}</td>
                        </tr>
                      )) : (
                        <tr><td colSpan={5} className="text-muted text-center">No templates — use “Sync Templates”.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="card">
                <div className="card-header"><h5 className="card-title mb-0">WhatsApp Sub-accounts</h5></div>
                <div className="card-body">
                  {children.length ? children.map((c) => (
                    <Link key={c.u_id} href={`/wamaster/users/${c.u_id}`} className="badge bg-primary-subtle text-primary fs-12 me-1 mb-1">{c.u_username}</Link>
                  )) : (
                    <p className="text-muted mb-0">None</p>
                  )}
                  <Link href="/wamaster/users/create?ut=2" className="btn btn-sm btn-soft-primary ms-2">Add WhatsApp user</Link>
                </div>
              </div>

              <div className="card">
                <div className="card-header d-flex align-items-center">
                  <h5 className="card-title mb-0 flex-grow-1">Google Sheet Emails</h5>
                  <ActionForm action={addEmail.bind(null, id)} className="d-flex gap-2" showAlert={false} resetOnSuccess>
                    <input type="email" name="email" className="form-control form-control-sm" placeholder="email@gmail.com" required aria-label="Email" />
                    <input type="number" name="sheet_limit" className="form-control form-control-sm" style={{ width: '90px' }} placeholder="Limit" aria-label="Sheet limit" />
                    <SubmitButton className="btn btn-sm btn-primary">Add</SubmitButton>
                  </ActionForm>
                </div>
                <div className="card-body table-responsive">
                  <table className="table table-sm table-striped align-middle mb-0">
                    <thead className="table-light"><tr><th>Email</th><th>Sheet Limit</th><th>Status</th><th /></tr></thead>
                    <tbody>
                      {emails.length ? emails.map((e) => (
                        <tr key={e.ue_id}>
                          <td>{e.ue_email_id}</td>
                          <td>{e.ue_sheet_limit}</td>
                          <td><form action={toggleEmail.bind(null, id, e.ue_id)}><button className={`badge border-0 ${Number(e.ue_status) === 1 ? 'bg-success' : 'bg-secondary'}`}>{Number(e.ue_status) === 1 ? 'Active' : 'Inactive'}</button></form></td>
                          <td><form action={deleteEmail.bind(null, id, e.ue_id)}><ConfirmButton message="Delete?" className="btn btn-sm btn-soft-danger" aria-label="Delete"><i className="ri-delete-bin-fill" /></ConfirmButton></form></td>
                        </tr>
                      )) : (
                        <tr><td colSpan={4} className="text-muted text-center">No emails.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {sheets.length > 0 && (
                <div className="card">
                  <div className="card-header"><h5 className="card-title mb-0">Google Sheets (Summary)</h5></div>
                  <div className="card-body table-responsive">
                    <table className="table table-sm table-striped align-middle mb-0">
                      <thead className="table-light"><tr><th>Sheet Type</th><th className="text-end">Active</th><th className="text-end">Total</th></tr></thead>
                      <tbody>
                        {[...sheetGroups.entries()].map(([type, g]) => (
                          <tr key={type}>
                            <td>{sheetName(type)}</td>
                            <td className="text-end">{g.active}</td>
                            <td className="text-end">{g.total}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot><tr><th>Total</th><th className="text-end">{activeSheets}</th><th className="text-end">{sheets.length}</th></tr></tfoot>
                    </table>
                  </div>
                </div>
              )}

              <div className="card">
                <div className="card-header"><h5 className="card-title mb-0">Active Sheets ({sheets.length})</h5></div>
                <div className="card-body table-responsive" style={{ maxHeight: '400px' }}>
                  <table className="table table-sm table-striped align-middle mb-0">
                    <thead className="table-light"><tr><th>Sheet ID</th><th>Type</th><th>Activated</th><th>Valid Till</th><th>Status</th><th /></tr></thead>
                    <tbody>
                      {sheets.length ? sheets.map((s) => (
                        <tr key={s.us_id}>
                          <td className="small text-break">{s.us_sheet_id}</td>
                          <td>{sheetName(s.us_sheet_type)}</td>
                          <td>{date(s.us_created_on)}</td>
                          <td>{date(s.us_valid_till)}</td>
                          <td><form action={toggleSheet.bind(null, id, s.us_id)}><button className={`badge border-0 ${Number(s.us_status) === 1 ? 'bg-success' : 'bg-secondary'}`}>{Number(s.us_status) === 1 ? 'Active' : 'Inactive'}</button></form></td>
                          <td><form action={deleteSheet.bind(null, id, s.us_id)}><ConfirmButton message="Delete?" className="btn btn-sm btn-soft-danger" aria-label="Delete"><i className="ri-delete-bin-fill" /></ConfirmButton></form></td>
                        </tr>
                      )) : (
                        <tr><td colSpan={6} className="text-muted text-center">No sheets.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card">
                <div className="card-header d-flex align-items-center">
                  <h5 className="card-title mb-0 flex-grow-1">Data Extractor Keys</h5>
                  <form action={generateKey.bind(null, id)}><button className="btn btn-sm btn-primary">Generate Key</button></form>
                </div>
                <div className="card-body table-responsive">
                  <table className="table table-sm table-striped align-middle mb-0">
                    <thead className="table-light"><tr><th>Key</th><th>Valid Till</th><th>Logged In</th><th>Last Login</th><th /></tr></thead>
                    <tbody>
                      {keys.length ? keys.map((k) => (
                        <tr key={k.dek_id}>
                          <td><code>{k.dek_key}</code></td>
                          <td>{date(k.dek_valid_till)}</td>
                          <td>{Number(k.dek_is_login) ? 'Yes' : 'No'}</td>
                          <td>{date(k.dek_last_login, 'd-m-Y H:i')}</td>
                          <td className="text-nowrap">
                            {Number(k.dek_is_login) ? (
                              <><form action={logoutKey.bind(null, id, k.dek_id)} className="d-inline"><button className="btn btn-sm btn-soft-warning">Logout</button></form>{' '}</>
                            ) : null}
                            <form action={deleteKey.bind(null, id, k.dek_id)} className="d-inline"><ConfirmButton message="Delete key?" className="btn btn-sm btn-soft-danger" aria-label="Delete"><i className="ri-delete-bin-fill" /></ConfirmButton></form>
                          </td>
                        </tr>
                      )) : (
                        <tr><td colSpan={5} className="text-muted text-center">No keys.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

