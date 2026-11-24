import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm, FieldError, SubmitButton } from '@/components/ActionForm';
import { PageTitle } from '@/components/PageTitle';
import { requireAdminCan } from '@/lib/auth';
import { one } from '@/lib/db';
import { CRM_WA_DAYS_MAX, crmWaSettings, expiringAccounts, lowLimitAccounts, maskKey } from '@/lib/services/expiry-report';
import { numberFormat } from '@/lib/text';
import { phpDate } from '@/lib/time';
import { SettingsTabs } from '../parts';
import { saveCrmWa, sendCrmWaNow } from './actions';

export const metadata: Metadata = { title: 'CRM WA' };

/** Settings → CRM WA: the daily 11:00 expiry report sent through the CRM WhatsApp API (super admin). */
export default async function CrmWaPage() {
  await requireAdminCan('super');
  const s = await crmWaSettings();
  const [rows, low, lastRun] = await Promise.all([
    expiringAccounts(s.days),
    lowLimitAccounts(s.limitPercent),
    one<{ at: Date; result: string | null }>("SELECT last_run_at AS at, last_result AS result FROM wa_job_runs WHERE job = 'expiry-report'"),
  ]);
  return (
    <>
      <PageTitle title="Settings" home="/wamaster/dashboard" />
      <SettingsTabs tab="crm_wa" />
      <div className="row">
        <div className="col-xl-6">
          <div className="card">
            <div className="card-header"><h5 className="card-title mb-0"><i className="ri-calendar-close-line me-1" />Expiry Report on WhatsApp</h5></div>
            <div className="card-body">
              <p className="text-muted small">
                Every day at <b>11:00 AM</b> two lists of WhatsApp users are sent to the group / numbers below through the CRM WhatsApp API,
                each as an image (<code>filePathUrl</code>) with the list as text: accounts expiring in the next {s.days} days (User Name, Company,
                Expiry Date) and accounts with a sending limit that have {s.limitPercent}% or less of it left.
                Nothing is sent on days when no user is in either list.
              </p>
              <ActionForm action={saveCrmWa} key={`${s.enabled}${s.apiKey}${s.groupIds}${s.mobileNos}${s.days}${s.limitPercent}${s.apiUrl}`}>
                <div className="form-check form-switch mb-3">
                  <input className="form-check-input" type="checkbox" role="switch" id="enabled" name="enabled" value="1" defaultChecked={s.enabled} />
                  <label className="form-check-label fw-semibold" htmlFor="enabled">Send the report every day at 11:00 AM</label>
                </div>
                <div className="mb-3">
                  <label className="form-label" htmlFor="api_url">API URL</label>
                  <input className="form-control" id="api_url" name="api_url" defaultValue={s.apiUrl} required />
                  <FieldError name="api_url" />
                </div>
                <div className="mb-3">
                  <label className="form-label" htmlFor="api_key">x-api-key</label>
                  <input type="password" className="form-control" id="api_key" name="api_key" autoComplete="off"
                    placeholder={s.apiKey ? `Saved: ${maskKey(s.apiKey)} (leave empty to keep)` : 'Paste the x-api-key'} />
                  <FieldError name="api_key" />
                </div>
                <div className="mb-3">
                  <label className="form-label" htmlFor="group_ids">recipientGroupIds</label>
                  <input className="form-control" id="group_ids" name="group_ids" defaultValue={s.groupIds} placeholder="120363431942002851@g.us" />
                  <div className="form-text">WhatsApp group IDs, separated by commas.</div>
                  <FieldError name="group_ids" />
                </div>
                <div className="mb-3">
                  <label className="form-label" htmlFor="mobile_nos">receiverMobileNo</label>
                  <input className="form-control" id="mobile_nos" name="mobile_nos" defaultValue={s.mobileNos} placeholder="919876543210" />
                  <div className="form-text">Mobile numbers with country code, separated by commas (optional).</div>
                  <FieldError name="mobile_nos" />
                </div>
                <div className="mb-3" style={{ maxWidth: 220 }}>
                  <label className="form-label" htmlFor="days">Accounts expiring in the next (days)</label>
                  <input type="number" className="form-control" id="days" name="days" min={1} max={CRM_WA_DAYS_MAX} step={1} defaultValue={s.days} required />
                  <FieldError name="days" />
                </div>
                <div className="mb-3" style={{ maxWidth: 220 }}>
                  <label className="form-label" htmlFor="limit_percent">Sending limit left (%) or less</label>
                  <input type="number" className="form-control" id="limit_percent" name="limit_percent" min={1} max={100} step={1} defaultValue={s.limitPercent} required />
                  <div className="form-text">Users with a template message limit only.</div>
                  <FieldError name="limit_percent" />
                </div>
                <SubmitButton className="btn btn-primary">Save</SubmitButton>
              </ActionForm>
            </div>
          </div>
        </div>

        <div className="col-xl-6">
          <div className="card">
            <div className="card-header d-flex align-items-center">
              <h5 className="card-title mb-0 flex-grow-1">Users Expiring in Next {s.days} Days ({rows.length})</h5>
              {rows.length > 0 && <Link href="/wamaster/settings/crm_wa/preview?r=expiry" target="_blank" className="btn btn-sm btn-soft-primary"><i className="ri-image-line me-1" />Preview image</Link>}
            </div>
            <div className="card-body">
              {rows.length ? (
                <div className="table-responsive mb-3">
                  <table className="table table-sm align-middle mb-0">
                    <thead className="table-light"><tr><th>User Name</th><th>Company</th><th>Expiry Date</th></tr></thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.u_id}>
                          <td><Link href={`/wamaster/users/${r.u_id}`}>{r.name || r.username}</Link></td>
                          <td>{r.company || '—'}</td>
                          <td>{phpDate('d-m-Y', Number(r.valid_till))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-muted mb-0">No account expires in the next {s.days} days.</p>
              )}
            </div>
          </div>
          <div className="card">
            <div className="card-header d-flex align-items-center">
              <h5 className="card-title mb-0 flex-grow-1">Sending Limit {s.limitPercent}% or Less Left ({low.length})</h5>
              {low.length > 0 && <Link href="/wamaster/settings/crm_wa/preview?r=limit" target="_blank" className="btn btn-sm btn-soft-primary"><i className="ri-image-line me-1" />Preview image</Link>}
            </div>
            <div className="card-body">
              {low.length ? (
                <div className="table-responsive mb-3">
                  <table className="table table-sm align-middle mb-0">
                    <thead className="table-light"><tr><th>User Name</th><th>Company</th><th className="text-end">Limit</th><th className="text-end">Remaining</th></tr></thead>
                    <tbody>
                      {low.map((r) => (
                        <tr key={r.u_id}>
                          <td><Link href={`/wamaster/users/${r.u_id}`}>{r.name || r.username}</Link></td>
                          <td>{r.company || '—'}</td>
                          <td className="text-end">{numberFormat(r.msg_limit)}</td>
                          <td className="text-end">{numberFormat(r.remaining)} <span className="text-muted small">({Math.round(Number(r.percent))}%)</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-muted">No user with a sending limit has {s.limitPercent}% or less left.</p>
              )}
              {!rows.length && !low.length && <p className="text-muted small">Both lists are empty, so today&apos;s report would not be sent.</p>}
              <ActionForm action={sendCrmWaNow} confirm="Send the report to the WhatsApp group / numbers now?">
                <SubmitButton className="btn btn-success" disabled={!rows.length && !low.length}><i className="ri-send-plane-2-line me-1" />Send now</SubmitButton>
              </ActionForm>
              <div className="small text-muted mt-2">
                Last automatic run: {lastRun ? `${phpDate('d-m-Y H:i', Math.floor(new Date(lastRun.at).getTime() / 1000))}${lastRun.result ? ` — ${lastRun.result}` : ''}` : 'not yet'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
