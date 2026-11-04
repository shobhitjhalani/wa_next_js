import Link from 'next/link';
import { config } from '@/lib/config';
import { query } from '@/lib/db';
import { masterOptions } from '@/lib/models';
import { USER_TYPE, type UserRow } from '@/lib/types';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { saveUser } from './actions';
import { FLAGS } from './flags';


const FLAG_LABELS: Record<(typeof FLAGS)[number], string> = {
  send_wa: 'Send Flow', wa_enable_incoming: 'Incoming Webhook', wa_enable_catalogue: 'Catalogue',
  send_app: 'Forward to App URL', is_new_no: 'MM Lite (Marketing)', enable_ai: 'AI',
  google_sheet: 'Google Sheet', wa_coexistence: 'Coexistence (Mobile & Web)', own_account: 'Client manages own WABA',
};

/** Add / edit user form (admin/users/form.blade.php). `user` is null when adding. */
export async function UserForm({ user, type }: { user: UserRow | null; type: number }) {
  const [parents, states, countries, staff] = await Promise.all([
    query<{ u_id: number; u_name: string | null; u_company_name: string | null }>(
      'SELECT u_id, u_name, u_company_name FROM js_user WHERE u_dstatus = 0 AND u_type = $1 ORDER BY u_name', [USER_TYPE.CORPORATE]),
    masterOptions(config.masters.state),
    masterOptions(config.masters.country),
    query<{ emp_id: number; emp_name: string | null }>('SELECT emp_id, emp_name FROM js_employee WHERE emp_dstatus = 0 AND emp_status = 1 ORDER BY emp_name'),
  ]);
  const isWa = type === USER_TYPE.WHATSAPP;
  const u = (user ?? { u_type: type, u_status: 1 }) as Partial<UserRow> & Record<string, unknown>;
  const v = (key: string): string => {
    const val = u[`u_${key}`];
    return val == null ? '' : String(val);
  };
  const exists = user !== null;

  return (
    <ActionForm action={saveUser.bind(null, user?.u_id ?? 0)}>
      <input type="hidden" name="ut" value={type} />

      <div className="card">
        <div className="card-header"><h5 className="card-title mb-0">Account</h5></div>
        <div className="card-body row g-3">
          <div className="col-md-4"><label className="form-label" htmlFor="name">Name *</label><input className="form-control" id="name" name="name" defaultValue={v('name')} required /></div>
          <div className="col-md-4"><label className="form-label" htmlFor="company_name">Company Name</label><input className="form-control" id="company_name" name="company_name" defaultValue={v('company_name')} /></div>
          <div className="col-md-4"><label className="form-label" htmlFor="company_gst_no">Company GSTIN</label><input className="form-control" id="company_gst_no" name="company_gst_no" defaultValue={v('company_gst_no')} /></div>
          <div className="col-md-4"><label className="form-label" htmlFor="mobile_no">Mobile No</label><input className="form-control" id="mobile_no" name="mobile_no" defaultValue={v('mobile_no')} /></div>
          <div className="col-md-4"><label className="form-label" htmlFor="email_id">Primary Email</label><input type="email" className="form-control" id="email_id" name="email_id" defaultValue={v('email_id')} /></div>
          <div className="col-md-4"><label className="form-label" htmlFor="billing_email_id">Billing Email</label><input type="email" className="form-control" id="billing_email_id" name="billing_email_id" defaultValue={v('billing_email_id')} /></div>
          <div className="col-md-4"><label className="form-label" htmlFor="username">Username *</label><input className="form-control" id="username" name="username" defaultValue={v('username')} required autoComplete="off" /></div>
          <div className="col-md-4"><label className="form-label" htmlFor="password">Password {exists ? '(leave blank to keep)' : '*'}</label><input type="password" className="form-control" id="password" name="password" autoComplete="new-password" required={!exists} /></div>
          <div className="col-md-4">
            <label className="form-label" htmlFor="status">Status</label>
            <select className="form-select" id="status" name="status" defaultValue={v('status') === '2' ? '2' : '1'}>
              <option value="1">Active</option>
              <option value="2">Inactive</option>
            </select>
          </div>
          {isWa && (
            <div className="col-md-4">
              <label className="form-label" htmlFor="parent_id">Parent (Corporate) Account</label>
              <select className="form-select" id="parent_id" name="parent_id" defaultValue={v('parent_id')}>
                <option value="">—</option>
                {parents.map((p) => <option key={p.u_id} value={p.u_id}>{p.u_company_name || p.u_name}</option>)}
              </select>
            </div>
          )}
          <div className="col-md-4">
            <label className="form-label" htmlFor="country">Country</label>
            <select className="form-select" id="country" name="country" defaultValue={v('country')}>
              <option value="">—</option>
              {countries.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="col-md-4">
            <label className="form-label" htmlFor="state">State</label>
            <select className="form-select" id="state" name="state" defaultValue={v('state')}>
              <option value="">—</option>
              {states.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="col-md-4">
            <label className="form-label" htmlFor="assign_to">Assign To</label>
            <select className="form-select" id="assign_to" name="assign_to" defaultValue={v('assign_to')}>
              <option value="">—</option>
              {staff.map((s) => <option key={s.emp_id} value={s.emp_id}>{s.emp_name}</option>)}
            </select>
          </div>
          <div className="col-md-4"><label className="form-label" htmlFor="balance">Previous Balance</label><input type="number" className="form-control" id="balance" name="balance" defaultValue={v('balance')} /></div>
          {!isWa && (
            <div className="col-md-4"><label className="form-label" htmlFor="google_sheet_email">Google Sheet Email</label><input type="email" className="form-control" id="google_sheet_email" name="google_sheet_email" defaultValue={v('google_sheet_email')} /></div>
          )}
        </div>
      </div>

      {isWa && (
        <div className="card">
          <div className="card-header"><h5 className="card-title mb-0">WhatsApp</h5></div>
          <div className="card-body row g-3">
            <div className="col-md-3"><label className="form-label" htmlFor="wa_no">WA Phone No</label><input className="form-control" id="wa_no" name="wa_no" defaultValue={v('wa_no')} /></div>
            <div className="col-md-3"><label className="form-label" htmlFor="wa_phone_id">WA Phone ID</label><input className="form-control" id="wa_phone_id" name="wa_phone_id" defaultValue={v('wa_phone_id')} /></div>
            <div className="col-md-3"><label className="form-label" htmlFor="wa_b_id">WABA ID</label><input className="form-control" id="wa_b_id" name="wa_b_id" defaultValue={v('wa_b_id')} /></div>
            <div className="col-md-3"><label className="form-label" htmlFor="business_id">Business ID</label><input className="form-control" id="business_id" name="business_id" defaultValue={v('business_id')} /></div>
            <div className="col-md-3"><label className="form-label" htmlFor="msg_limit">Total Limit (0 = unlimited)</label><input type="number" min="0" className="form-control" id="msg_limit" name="msg_limit" defaultValue={v('msg_limit')} /></div>
            <div className="col-md-3"><label className="form-label" htmlFor="daily_limit">Daily Limit</label><input type="number" min="0" className="form-control" id="daily_limit" name="daily_limit" defaultValue={v('daily_limit')} /></div>
            <div className="col-md-6"><label className="form-label" htmlFor="wa_incoming_url">Incoming URL (forward replies)</label><input type="url" className="form-control" id="wa_incoming_url" name="wa_incoming_url" defaultValue={v('wa_incoming_url')} /></div>
            <div className="col-md-6"><label className="form-label" htmlFor="wa_catalogue_url">Catalogue Order URL</label><input type="url" className="form-control" id="wa_catalogue_url" name="wa_catalogue_url" defaultValue={v('wa_catalogue_url')} /></div>
            <div className="col-md-6"><label className="form-label" htmlFor="wa_form_url">Flow Response URL</label><input type="url" className="form-control" id="wa_form_url" name="wa_form_url" defaultValue={v('wa_form_url')} /></div>
            <div className="col-md-6"><label className="form-label" htmlFor="wa_app_url">App URL (raw webhook forward)</label><input type="url" className="form-control" id="wa_app_url" name="wa_app_url" defaultValue={v('wa_app_url')} /></div>
            <div className="col-md-6"><label className="form-label" htmlFor="ai_key">AI API Key</label><input className="form-control" id="ai_key" name="ai_key" defaultValue={v('ai_key')} autoComplete="off" /></div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header"><h5 className="card-title mb-0">Options</h5></div>
        <div className="card-body row g-3">
          {FLAGS.filter((f) => (isWa ? f !== 'own_account' : f === 'google_sheet' || f === 'own_account')).map((flag) => (
            <div className="col-md-3" key={flag}>
              <div className="form-check form-switch">
                <input className="form-check-input" type="checkbox" role="switch" id={`flag_${flag}`} name={flag} value="1" defaultChecked={v(flag) === '1'} />
                <label className="form-check-label" htmlFor={`flag_${flag}`}>{FLAG_LABELS[flag]}</label>
              </div>
            </div>
          ))}
        </div>
      </div>

      <SubmitButton className="btn btn-success">Save</SubmitButton>{' '}
      <Link href={exists ? `/wamaster/users/${user.u_id}` : `/wamaster/users?ut=${type}`} className="btn btn-light">Cancel</Link>
    </ActionForm>
  );
}
