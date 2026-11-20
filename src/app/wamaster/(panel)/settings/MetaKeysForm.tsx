'use client';

import { useState } from 'react';
import { ActionForm, FieldError, SubmitButton } from '@/components/ActionForm';
import { saveMetaKeys } from './actions';

export interface KeyStatus { key: 'systemUserToken' | 'appSecret' | 'webhookVerifyToken'; name: string; label: string; env: string; source: 'settings' | 'env' | 'none'; hint: string; updated: string; help: React.ReactNode }

/** One secret: where it comes from now, a field for a new value (never pre-filled), Show, and Remove (back to .env). */
function SecretField({ s, generate }: { s: KeyStatus; generate?: boolean }) {
  const [show, setShow] = useState(false);
  const [value, setValue] = useState('');
  const badge = s.source === 'settings' ? <span className="badge bg-success-subtle text-success">Set here</span>
    : s.source === 'env' ? <span className="badge bg-info-subtle text-info">From .env</span>
      : <span className="badge bg-danger-subtle text-danger">Not set</span>;
  return (
    <div className="border rounded p-3 mb-3">
      <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
        <label className="form-label fw-semibold mb-0 me-auto" htmlFor={`mk-${s.name}`}>{s.label}</label>
        {badge}
        {s.hint && <span className="small text-muted font-monospace">{s.hint}</span>}
      </div>
      <div className="input-group">
        <input className="form-control font-monospace" id={`mk-${s.name}`} name={s.name} type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false}
          value={value} onChange={(e) => setValue(e.target.value)} placeholder={s.source === 'none' ? 'Paste the value' : 'Leave empty to keep the current value'} />
        <button type="button" className="btn btn-light border" onClick={() => setShow(!show)} title={show ? 'Hide' : 'Show'} aria-label={show ? 'Hide' : 'Show'}>
          <i className={show ? 'ri-eye-off-line' : 'ri-eye-line'} />
        </button>
        {generate && (
          <button type="button" className="btn btn-light border" title="Make a random token"
            onClick={() => { const a = new Uint8Array(24); crypto.getRandomValues(a); setValue([...a].map((b) => b.toString(16).padStart(2, '0')).join('')); setShow(true); }}>
            <i className="ri-refresh-line" /> Generate
          </button>
        )}
      </div>
      <FieldError name={s.name} />
      <div className="form-text">{s.help}</div>
      {s.source === 'settings' && (
        <div className="form-check mt-2">
          <input className="form-check-input" type="checkbox" id={`clear-${s.key}`} name={`clear_${s.key}`} value="1" />
          <label className="form-check-label small" htmlFor={`clear-${s.key}`}>Remove the value saved here{s.env ? ` (use ${s.env} from .env)` : ''}</label>
        </div>
      )}
      {s.updated && <div className="small text-muted mt-1">{s.updated}</div>}
    </div>
  );
}

export function MetaKeysForm({ keys }: { keys: KeyStatus[] }) {
  return (
    <ActionForm action={saveMetaKeys}>
      {keys.map((s) => <SecretField key={s.key} s={s} generate={s.key === 'webhookVerifyToken'} />)}
      <SubmitButton className="btn btn-primary" pendingText="Saving…"><i className="ri-save-line" /> Save keys</SubmitButton>
    </ActionForm>
  );
}
