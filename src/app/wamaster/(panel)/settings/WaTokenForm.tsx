'use client';

import { useState } from 'react';
import { ActionForm, FieldError, SubmitButton } from '@/components/ActionForm';
import { saveSignupIds, saveWaToken } from './actions';

/** New WhatsApp sending token (never pre-filled); Meta checks it before it is saved. */
export function WaTokenForm() {
  const [show, setShow] = useState(false);
  return (
    <ActionForm action={saveWaToken} confirm="Replace the WhatsApp token? Every WhatsApp message (campaigns, chat, API, chatbot) is sent with it.">
      <label className="form-label fw-semibold" htmlFor="wa_token">New token</label>
      <div className="input-group">
        <input className="form-control font-monospace" id="wa_token" name="wa_token" type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false} placeholder="EAA…" />
        <button type="button" className="btn btn-light border" onClick={() => setShow(!show)} aria-label={show ? 'Hide' : 'Show'}><i className={show ? 'ri-eye-off-line' : 'ri-eye-line'} /></button>
      </div>
      <FieldError name="wa_token" />
      <div className="form-check mt-2">
        <input className="form-check-input" type="checkbox" id="wa_force" name="force" value="1" />
        <label className="form-check-label small" htmlFor="wa_force">Save anyway if Meta refuses it</label>
      </div>
      <SubmitButton className="btn btn-primary mt-3" pendingText="Checking with Meta…"><i className="ri-save-line" /> Save token</SubmitButton>
    </ActionForm>
  );
}

/** App ID + Configuration ID of the "Login with Facebook" Embedded Signup (empty = the built-in defaults). */
export function SignupIdsForm({ appId, configId, defaults }: { appId: string; configId: string; defaults: { appId: string; configId: string } }) {
  return (
    <ActionForm action={saveSignupIds}>
      <div className="row g-3">
        <div className="col-md-6">
          <label className="form-label" htmlFor="signup_app_id">Facebook App ID</label>
          <input className="form-control font-monospace" id="signup_app_id" name="signup_app_id" defaultValue={appId === defaults.appId ? '' : appId} placeholder={defaults.appId} inputMode="numeric" />
          <FieldError name="signup_app_id" />
        </div>
        <div className="col-md-6">
          <label className="form-label" htmlFor="signup_config_id">Configuration ID</label>
          <input className="form-control font-monospace" id="signup_config_id" name="signup_config_id" defaultValue={configId === defaults.configId ? '' : configId} placeholder={defaults.configId} inputMode="numeric" />
          <FieldError name="signup_config_id" />
        </div>
      </div>
      <div className="form-text">Empty = the default shown in grey. In use now: App ID <b>{appId}</b>, Configuration ID <b>{configId}</b>.</div>
      <SubmitButton className="btn btn-primary mt-3" pendingText="Saving…"><i className="ri-save-line" /> Save IDs</SubmitButton>
    </ActionForm>
  );
}
