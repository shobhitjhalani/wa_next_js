'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

/** Refresh the campaign's figures (no automatic reload); shows when they were last updated. */
export function RefreshButton() {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [at, setAt] = useState('');
  useEffect(() => { setAt(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })); }, []);
  const refresh = () => start(() => {
    router.refresh();
    setAt(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  });
  return (
    <button type="button" className="btn btn-soft-primary" onClick={refresh} disabled={busy} title={at ? `Last updated ${at}` : 'Refresh'}>
      <i className={busy ? 'ri-loader-4-line' : 'ri-refresh-line'} /> {busy ? 'Refreshing…' : 'Refresh'}
    </button>
  );
}
