'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

/** Re-render the current page's server data (keeps filters, page and scroll position). */
export function RefreshButton({ className = 'btn btn-sm btn-soft-secondary', label = 'Refresh' }: { className?: string; label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" className={className} disabled={pending} onClick={() => start(() => router.refresh())} title="Refresh the table" aria-label="Refresh">
      <i className={`ri-refresh-line${pending ? ' spin' : ''}`} /> {pending ? 'Refreshing…' : label}
    </button>
  );
}
