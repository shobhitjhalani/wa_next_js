'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { tryMessage } from './actions';

/** “Try a message”: which active quick reply would answer what a customer types. Nothing is sent. */
export function TryMessage() {
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ id: number; name: string; keyword: string } | null | undefined>(undefined);
  const [busy, start] = useTransition();
  const run = () => {
    if (!text.trim()) return;
    start(async () => setResult(await tryMessage(text)));
  };
  return (
    <div className="border rounded p-2 mb-3 bg-light-subtle">
      <form className="d-flex flex-wrap gap-2 align-items-center" onSubmit={(e) => { e.preventDefault(); run(); }}>
        <label htmlFor="qr_try" className="small fw-medium mb-0"><i className="ri-flask-line me-1" />Try a message</label>
        <input id="qr_try" className="form-control form-control-sm" style={{ maxWidth: 320 }} value={text} maxLength={500}
          placeholder="Type what a customer would send…" onChange={(e) => { setText(e.target.value); setResult(undefined); }} />
        <button type="submit" className="btn btn-sm btn-primary" disabled={busy || !text.trim()}>{busy ? 'Checking…' : 'Check'}</button>
        {result === null && <span className="small text-muted">No active quick reply answers this message.</span>}
        {result && (
          <span className="small text-success">
            <i className="ri-check-line" /> Answered by <Link href={`/quick_replies/${result.id}`} className="fw-medium">{result.name}</Link>
            {result.keyword && <> (keyword “{result.keyword}”)</>}
          </span>
        )}
      </form>
    </div>
  );
}
