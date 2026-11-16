'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { PAGE_SIZES, tableHref } from '@/lib/datatable';

/**
 * "Show N entries" + live "Search" for a server-side DataTable. Only changes the URL (back to
 * page 1); the page re-renders on the server. `query` is the current query string.
 */
export function DataTableControls({ path, query, perPage, q, total, placeholder = 'Search…' }: {
  path: string; query: string; perPage: number; q: string; placeholder?: string;
  /** Matching rows, shown as "Total: N". */
  total?: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Back / forward or a filter form changed ?q= — show it
  useEffect(() => { setText(q); }, [q]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const go = (changes: Record<string, string | number | null>) => {
    startTransition(() => router.replace(tableHref(path, new URLSearchParams(query), { ...changes, page: null }), { scroll: false }));
  };

  return (
    <div className="d-flex flex-wrap align-items-center gap-2 mb-3 datatable-controls">
      <label className="d-flex align-items-center gap-2 mb-0 small text-muted">
        Show
        <select className="form-select form-select-sm w-auto" value={perPage} aria-label="Rows per page" onChange={(e) => go({ per_page: e.target.value })}>
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        entries
      </label>
      {total !== undefined && <span className="badge bg-primary-subtle text-primary fs-6 fw-semibold">Total: {total.toLocaleString('en-US')}</span>}
      {pending && <span className="spinner-border spinner-border-sm text-primary" role="status" aria-label="Loading" />}
      <div className="ms-auto position-relative datatable-search">
        <i className="ri-search-line position-absolute top-50 translate-middle-y ms-2 text-muted" aria-hidden />
        <input
          type="search" className="form-control form-control-sm ps-4" placeholder={placeholder} aria-label="Search table" value={text} maxLength={100}
          onChange={(e) => {
            const v = e.target.value;
            setText(v);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => go({ q: v.trim() || null }), 400);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault(); // don't submit a surrounding form
            clearTimeout(timer.current);
            go({ q: text.trim() || null });
          }}
        />
      </div>
    </div>
  );
}
