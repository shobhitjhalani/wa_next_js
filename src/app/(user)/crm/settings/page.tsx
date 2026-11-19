import '../crm.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageTitle } from '@/components/PageTitle';
import { ConfirmButton } from '@/components/ui';
import { requireCrmUser } from '@/lib/auth';
import { LEAD_SOURCES } from '@/lib/crm';
import { crmSettings, customSources, webhookUrl } from '@/lib/services/crm';
import { CopyButton } from '../../api_docs/CopyButton';
import { deleteLeadSource, regenerateWebhook } from '../actions';
import { AddSourceForm, FacebookForm, ReminderForm } from './SettingsForms';

export const metadata: Metadata = { title: 'CRM Settings' };

/** Webhook URL, Facebook Lead Ads connection and follow-up reminders. */
export default async function CrmSettingsPage() {
  const user = await requireCrmUser();
  const [s, own] = await Promise.all([crmSettings(user.u_id), customSources(user.u_id)]);
  const hook = webhookUrl(s.cs_key);
  const sample = `curl -X POST '${hook}' \\
  -H 'Content-Type: application/json' \\
  -d '{"name":"Rahul Sharma","mobile":"9876543210","email":"rahul@example.com","source":"website","campaign":"Nexon EV offer","message":"Wants a test drive","city":"Jaipur"}'`;

  return (
    <>
      <PageTitle title="CRM Settings" home="/dashboard" />
      <div className="mb-3"><Link href="/crm" className="text-muted"><i className="ri-arrow-left-line align-middle" /> Leads</Link></div>

      <div className="card">
        <div className="card-header"><h5 className="card-title mb-0"><i className="ri-webhook-line me-1" />Your webhook URL</h5></div>
        <div className="card-body">
          <p className="text-muted">Leads sent to this URL are saved in your CRM. Use it as the <b>Callback URL</b> in Facebook, and in your website forms, Zapier, Make, Pabbly or Google Ads lead forms.</p>
          <label className="form-label small text-muted mb-1">Webhook URL (Callback URL)</label>
          <div className="input-group mb-3">
            <input className="form-control crm-code" readOnly value={hook} aria-label="Webhook URL" />
            <CopyButton text={hook} className="btn btn-soft-primary" />
          </div>
          <label className="form-label small text-muted mb-1">Verify token (for Facebook)</label>
          <div className="input-group mb-3" style={{ maxWidth: 480 }}>
            <input className="form-control crm-code" readOnly value={s.cs_verify_token} aria-label="Verify token" />
            <CopyButton text={s.cs_verify_token} className="btn btn-soft-primary" />
          </div>
          <form action={regenerateWebhook}>
            <ConfirmButton message="Create a new webhook URL and verify token? The current URL stops working, so update it in Facebook and your forms." className="btn btn-sm btn-soft-danger">
              <i className="ri-refresh-line" /> Create a new URL
            </ConfirmButton>
            <span className="small text-muted ms-2">Only if the URL leaked; the old one stops working.</span>
          </form>
        </div>
      </div>

      <div className="row">
        <div className="col-xl-7">
          <div className="card">
            <div className="card-header d-flex align-items-center">
              <h5 className="card-title mb-0 me-auto"><i className="ri-facebook-circle-fill text-primary me-1" />Facebook &amp; Instagram Lead Ads</h5>
              {s.cs_fb_page_token
                ? <span className="badge bg-success-subtle text-success"><i className="ri-checkbox-circle-line" /> Connected{s.cs_fb_page_name ? `: ${s.cs_fb_page_name}` : ''}</span>
                : <span className="badge bg-warning-subtle text-warning">Not connected</span>}
            </div>
            <div className="card-body">
              <ol className="ps-3 mb-4">
                <li className="mb-2">In <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">Meta for Developers</a>, open your app (or create a <b>Business</b> app) and add the <b>Webhooks</b> product.</li>
                <li className="mb-2">Choose <b>Page</b> → <b>Subscribe to this object</b>. Paste the <b>Webhook URL</b> above as the Callback URL and the <b>Verify token</b>, then <b>Verify and save</b>.</li>
                <li className="mb-2">In the list of Page fields, <b>subscribe to <code>leadgen</code></b>.</li>
                <li className="mb-2">Create a <b>Page access token</b> for the Page that runs your lead ads, with the permissions <code>leads_retrieval</code>, <code>pages_manage_metadata</code>, <code>pages_show_list</code> and <code>pages_read_engagement</code>. A token from a <b>System User</b> in Business Settings does not expire.</li>
                <li className="mb-2">Paste the token below and press <b>Save &amp; connect Page</b>. The Page is subscribed to your app automatically.</li>
                <li>Send a test lead with the <a href="https://developers.facebook.com/tools/lead-ads-testing" target="_blank" rel="noreferrer">Lead Ads Testing Tool</a>. It appears under <Link href="/crm?tab=new">Leads → New</Link> within seconds.</li>
              </ol>
              <FacebookForm hasSecret={!!s.cs_fb_app_secret} hasToken={!!s.cs_fb_page_token} pageName={s.cs_fb_page_name} />
              <div className="form-text mt-2">Instagram lead ads arrive the same way and are marked as Instagram.</div>
            </div>
          </div>
        </div>
        <div className="col-xl-5">
          <div className="card">
            <div className="card-header"><h5 className="card-title mb-0"><i className="ri-alarm-line me-1" />Follow-up reminders</h5></div>
            <div className="card-body">
              <p className="text-muted small">When a lead’s next follow-up is due, a reminder pops up in the panel. You can also get it by email.</p>
              <ReminderForm email={s.cs_remind_email} before={s.cs_remind_before} />
            </div>
          </div>
          <div className="card" id="sources">
            <div className="card-header"><h5 className="card-title mb-0"><i className="ri-price-tag-3-line me-1" />Lead sources</h5></div>
            <div className="card-body">
              <p className="small text-muted mb-2">Add your own sources to choose them on a lead and filter by them. A webhook <code>source</code> with the same name is matched to yours.</p>
              <AddSourceForm />
              <div className="d-flex flex-wrap gap-2 mt-3">
                {own.map((name) => (
                  <form key={name} action={deleteLeadSource.bind(null, name)} className="d-inline-flex">
                    <span className="badge bg-primary-subtle text-primary fs-6 fw-normal d-inline-flex align-items-center gap-1">
                      <i className="ri-price-tag-3-line" />{name}
                      <ConfirmButton message={`Remove the source “${name}”? Leads that have it keep it.`} className="btn btn-link p-0 ms-1 text-primary lh-1" title={`Remove ${name}`} aria-label={`Remove ${name}`}>
                        <i className="ri-close-line" />
                      </ConfirmButton>
                    </span>
                  </form>
                ))}
                {LEAD_SOURCES.map((src) => (
                  <span key={src.value} className="badge bg-light text-body border fs-6 fw-normal" title="Built-in source"><i className={`${src.icon} me-1`} />{src.label}</span>
                ))}
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h5 className="card-title mb-0"><i className="ri-global-line me-1" />Website, Zapier &amp; other sources</h5></div>
            <div className="card-body">
              <p className="small text-muted mb-2">POST a lead as JSON or form fields. Recognised fields: <code>name</code> (or <code>first_name</code> + <code>last_name</code>), <code>mobile</code> / <code>phone</code>, <code>email</code>, <code>source</code> (facebook, instagram, google, website…), <code>campaign</code>, <code>message</code>. Every other field is saved with the lead.</p>
              <div className="position-relative">
                <pre className="bg-light border rounded p-2 small mb-1 crm-code" style={{ whiteSpace: 'pre-wrap' }}>{sample}</pre>
              </div>
              <CopyButton text={sample} />
              <p className="small text-muted mt-2 mb-0">A lead with the same mobile as an open lead is added to that lead’s history instead of creating a duplicate.</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
