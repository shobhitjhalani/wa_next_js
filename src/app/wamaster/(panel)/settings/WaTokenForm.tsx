'use client';

import { useState } from 'react';
import { ActionForm, FieldError, SubmitButton } from '@/components/ActionForm';
import { saveWaToken } from './actions';

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
