'use client';

import { ActionForm, FieldError, SubmitButton } from '@/components/ActionForm';
import { MAX_SOURCE_NAME, REMIND_BEFORE } from '@/lib/crm';
import { addLeadSource, saveFacebookSettings, saveReminderSettings } from '../actions';

/** Add one of the account's own lead sources. */
export function AddSourceForm() {
  return (
    <ActionForm action={addLeadSource} resetOnSuccess>
      <div className="input-group">
        <input className="form-control" name="source_name" maxLength={MAX_SOURCE_NAME} placeholder="e.g. Justdial, IndiaMART, Walk-in" aria-label="New source name" />
        <SubmitButton className="btn btn-primary" pendingText="Adding…"><i className="ri-add-line" /> Add</SubmitButton>
      </div>
      <FieldError name="source_name" />
    </ActionForm>
  );
}

export function ReminderForm({ email, before }: { email: string; before: number }) {
  return (
    <ActionForm action={saveReminderSettings}>
      <div className="row g-3 align-items-end">
        <div className="col-12">
          <label className="form-label" htmlFor="remind_email">Email reminders to</label>
          <input type="email" className="form-control" id="remind_email" name="remind_email" defaultValue={email} placeholder="Leave empty for no reminder emails" />
          <FieldError name="remind_email" />
        </div>
        <div className="col-sm-8">
          <label className="form-label" htmlFor="remind_before">Send the reminder</label>
          <select className="form-select" id="remind_before" name="remind_before" defaultValue={before}>
            {REMIND_BEFORE.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <FieldError name="remind_before" />
        </div>
        <div className="col-sm-4">
          <SubmitButton className="btn btn-primary w-100" pendingText="Saving…">Save</SubmitButton>
        </div>
      </div>
    </ActionForm>
  );
}

export function FacebookForm({ hasSecret, hasToken, pageName }: { hasSecret: boolean; hasToken: boolean; pageName: string }) {
  return (
    <ActionForm action={saveFacebookSettings}>
      <div className="mb-3">
        <label className="form-label" htmlFor="page_token">Page access token</label>
        <textarea className="form-control crm-code" id="page_token" name="page_token" rows={3} autoComplete="off" spellCheck={false}
          placeholder={hasToken ? `Saved${pageName ? ` for “${pageName}”` : ''}. Paste a new token to replace it.` : 'EAAB… (needs the leads_retrieval and pages_manage_metadata permissions)'} />
        <FieldError name="page_token" />
        {hasToken && (
          <div className="form-check mt-1">
            <input className="form-check-input" type="checkbox" id="clear_token" name="clear_token" value="1" />
            <label className="form-check-label small" htmlFor="clear_token">Remove the saved token (disconnect)</label>
          </div>
        )}
      </div>
      <div className="mb-3">
        <label className="form-label" htmlFor="app_secret">App secret <span className="text-muted fw-normal">(optional, recommended)</span></label>
        <input className="form-control crm-code" id="app_secret" name="app_secret" autoComplete="off" spellCheck={false}
          placeholder={hasSecret ? 'Saved. Enter a new one to replace it.' : 'Meta App → App settings → Basic → App secret'} />
        <FieldError name="app_secret" />
        <div className="form-text">With the App secret, notifications that were not signed by your Facebook app are refused.</div>
        {hasSecret && (
          <div className="form-check mt-1">
            <input className="form-check-input" type="checkbox" id="clear_secret" name="clear_secret" value="1" />
            <label className="form-check-label small" htmlFor="clear_secret">Remove the saved App secret</label>
          </div>
        )}
      </div>
      <SubmitButton className="btn btn-primary" pendingText="Connecting…"><i className="ri-facebook-circle-line me-1" />Save &amp; connect Page</SubmitButton>
    </ActionForm>
  );
}
