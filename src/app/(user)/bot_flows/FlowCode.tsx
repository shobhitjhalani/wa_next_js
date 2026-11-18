'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { copyFlowCode, pasteFlowCode } from './actions';

/**
 * Copy a flow (all steps and connections) as a code, and paste such a code into
 * another account as a draft.
 */

async function toClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Copies the flow code; when the browser blocks the clipboard, shows the code to copy by hand. */
export function CopyFlowButton({ id, className, label, title }: { id: number; className?: string; label?: string; title?: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [manual, setManual] = useState<string | null>(null);
  const copy = async () => {
    setState('busy');
    try {
      const code = await copyFlowCode(id);
      if (await toClipboard(code)) {
        setState('done');
        setTimeout(() => setState('idle'), 2000);
      } else {
        setManual(code);
        setState('idle');
      }
    } catch {
      setState('idle');
      window.alert('The flow could not be copied. Please try again.');
    }
  };
  const icon = state === 'done' ? 'ri-check-line text-success' : state === 'busy' ? 'ri-loader-4-line' : 'ri-clipboard-line';
  return (
    <>
      <button type="button" className={className} onClick={copy} disabled={state === 'busy'}
        title={title ?? 'Copy flow — paste it into another account with “Paste flow”'} aria-label="Copy flow">
        <i className={icon} />{label && <> {state === 'done' ? 'Copied' : label}</>}
      </button>
      {manual !== null && (
        <Modal title="Copy flow" onClose={() => setManual(null)}>
          <p className="small text-muted">Copy this code (Ctrl + C), then use <b>Paste flow</b> in the other account.</p>
          <textarea className="form-control font-monospace small" rows={12} readOnly value={manual} onFocus={(e) => e.currentTarget.select()} autoFocus />
        </Modal>
      )}
    </>
  );
}

/** "Paste flow": paste a copied code (or upload it as a .json file) to add the flow as a draft. */
export function PasteFlowButton() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ id: number; message: string; warnings: string[] } | null>(null);
  const [busy, startBusy] = useTransition();
  const router = useRouter();

  const close = () => { setOpen(false); setCode(''); setError(''); setDone(null); };
  const paste = () => {
    setError('');
    startBusy(async () => {
      const res = await pasteFlowCode(code);
      if (!res.ok) { setError(res.error ?? 'The flow could not be added.'); return; }
      const data = res.data as { id: number; warnings: string[] };
      if (!data.warnings.length) { router.push(`/bot_flows/${data.id}`); return; }
      setDone({ id: data.id, message: res.message ?? '', warnings: data.warnings });
      router.refresh();
    });
  };
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 1_000_000) { setError('This file is too large.'); return; }
    setCode(await file.text());
    setError('');
  };

  return (
    <>
      <button type="button" className="btn btn-light border" onClick={() => setOpen(true)}><i className="ri-clipboard-fill" /> Paste flow</button>
      {open && (
        <Modal title="Paste a flow" onClose={close} busy={busy} footer={done ? (
          <>
            <button type="button" className="btn btn-light" onClick={close}>Close</button>
            <button type="button" className="btn btn-success" onClick={() => router.push(`/bot_flows/${done.id}`)}><i className="ri-edit-line" /> Open in Flow Builder</button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-light" onClick={close} disabled={busy}>Cancel</button>
            <button type="button" className="btn btn-success" onClick={paste} disabled={busy || !code.trim()}>
              <i className={busy ? 'ri-loader-4-line' : 'ri-add-line'} /> {busy ? 'Adding…' : 'Add as draft'}
            </button>
          </>
        )}>
          {done ? (
            <>
              <div className="alert alert-success py-2">{done.message}</div>
              <p className="fw-medium mb-1">Check before activating:</p>
              <ul className="small mb-0">{done.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </>
          ) : (
            <>
              <p className="small text-muted mb-2">
                In the account that has the flow, click <i className="ri-clipboard-line" /> <b>Copy flow</b>, then paste the code here.
                The flow is added to this account as a <b>Draft</b> with all its steps.
              </p>
              <textarea className="form-control font-monospace small" rows={10} value={code} autoFocus spellCheck={false}
                placeholder={'{\n  "type": "wa-chatbot-flow",\n  …\n}'} onChange={(e) => { setCode(e.target.value); setError(''); }} />
              <div className="d-flex align-items-center gap-2 mt-2">
                <span className="small text-muted">or</span>
                <input type="file" accept=".json,application/json,text/plain" className="form-control form-control-sm" onChange={(e) => readFile(e.target.files?.[0])} />
              </div>
              {error && <div className="alert alert-danger small py-2 mt-2 mb-0">{error}</div>}
              <div className="form-text mt-2">Templates belong to each WhatsApp account: template steps are checked against this account's approved templates.</div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}

function Modal({ title, onClose, busy, footer, children }: { title: string; onClose: () => void; busy?: boolean; footer?: React.ReactNode; children: React.ReactNode }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) closeRef.current(); };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('modal-open'); };
  }, [busy]);
  // Rendered on <body>, so a button inside a table / button group doesn't affect it
  return createPortal(
    <>
      <div className="modal fade show d-block text-start" tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
        onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
        <div className="modal-dialog modal-dialog-centered modal-lg">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">{title}</h5>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} disabled={busy} />
            </div>
            <div className="modal-body">{children}</div>
            {footer && <div className="modal-footer">{footer}</div>}
          </div>
        </div>
      </div>
      <div className="modal-backdrop fade show" />
    </>,
    document.body,
  );
}
