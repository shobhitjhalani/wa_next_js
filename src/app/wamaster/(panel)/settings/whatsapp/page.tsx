import type { Metadata } from 'next';
import { PageTitle } from '@/components/PageTitle';
import { requireAdminCan } from '@/lib/auth';
import { config } from '@/lib/config';
import { one } from '@/lib/db';
import { SIGNUP_DEFAULTS, signupIds, waToken } from '@/lib/services/meta';
import { SettingsTabs } from '../parts';
import { SignupIdsForm, WaTokenForm } from '../WaTokenForm';

export const metadata: Metadata = { title: 'WhatsApp Token' };

const SOURCE = {
  settings: ['bg-success-subtle text-success', 'Set here'],
  master: ['bg-warning-subtle text-warning', 'Old Data Master value'],
  env: ['bg-info-subtle text-info', 'From .env (WA_KEY)'],
  none: ['bg-danger-subtle text-danger', 'Not set: nothing can be sent'],
} as const;

/** Settings → WhatsApp Token (WA_TOKEN_KEY): the token every WhatsApp message is sent with (super admin). */
export default async function WaTokenPage() {
  await requireAdminCan('super');
  const [t, saved, signup] = await Promise.all([
    waToken(),
    one<{ at: Date; by: string | null }>(`SELECT s.updated_at AS at, e.emp_name AS by FROM wa_settings s LEFT JOIN js_employee e ON e.emp_id = s.updated_by WHERE s.key = 'wa_token_key'`),
    signupIds(),
  ]);
  const [badge, label] = SOURCE[t.source];
  return (
    <>
      <PageTitle title="Settings" home="/wamaster/dashboard" />
      <SettingsTabs tab="whatsapp" />
      <div className="row">
        <div className="col-xl-7">
          <div className="card">
            <div className="card-header"><h5 className="card-title mb-0">WhatsApp sending token (WA_TOKEN_KEY)</h5></div>
            <div className="card-body">
              <div className="d-flex flex-wrap align-items-center gap-2 mb-3 p-3 bg-light rounded">
                <span className="fw-semibold me-auto">Token in use</span>
                <span className={`badge ${badge}`}>{label}</span>
                {t.value && <span className="small text-muted font-monospace">…{t.value.slice(-4)} ({t.value.length} characters)</span>}
                {saved && t.source === 'settings' && (
                  <div className="w-100 small text-muted">Saved {new Date(saved.at).toLocaleString('en-IN', { timeZone: config.timezone, dateStyle: 'medium', timeStyle: 'short' })}{saved.by ? ` by ${saved.by}` : ' (copied from the old Data Master value)'}</div>
                )}
              </div>
              <WaTokenForm />
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h5 className="card-title mb-0"><i className="ri-facebook-circle-line me-1" />Embedded Signup (“Login with Facebook”)</h5></div>
            <div className="card-body">
              <p className="small text-muted">
                Users whose Phone ID or WABA ID is missing see “Login with Facebook” on their dashboard. Meta&apos;s signup popup connects their
                WhatsApp Business number; the ids are saved on their account, the number is registered and the webhook subscribed.
                Accounts with Coexistence switched on get the flow for an existing WhatsApp Business App number.
              </p>
              <SignupIdsForm appId={signup.appId} configId={signup.configId} defaults={SIGNUP_DEFAULTS} />
            </div>
          </div>
        </div>
        <div className="col-xl-5">
          <div className="card">
            <div className="card-body small">
              <h6>How it works</h6>
              <ul className="ps-3 mb-0">
                <li>Every WhatsApp message is sent with this token: campaigns, chat replies, API / OTP, chatbot, template sync, number registration.</li>
                <li>It is the System User token of the Meta app that owns the WhatsApp accounts (Business Settings → System users → Generate new token, with whatsapp_business_messaging and whatsapp_business_management, expiry Never).</li>
                <li>Before saving, Meta is asked whether it accepts the token; a refused token is only saved if you tick “Save anyway”.</li>
                <li>The app and the worker use a new token within 30 seconds. It is never shown again in full, and the Activity Log records who changed it (not the value).</li>
                <li>It replaces the old “WA Key” Data Master value, which was copied here.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
