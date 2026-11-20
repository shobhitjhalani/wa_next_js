'use client';

import { useEffect, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { ActionForm, FieldError, SubmitButton } from '@/components/ActionForm';
import { addPage, uploadPosts } from './actions';

export interface PickPage { id: number; name: string; client: string | null }

/** Tick the Pages to post to: search by Page or client name, select all shown / none. */
function PagePicker({ pages }: { pages: PickPage[] }) {
  const [picked, setPicked] = useState<Set<number>>(() => new Set(pages.length === 1 ? [pages[0].id] : []));
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const shown = term ? pages.filter((p) => `${p.name} ${p.client ?? ''}`.toLowerCase().includes(term)) : pages;
  const toggle = (id: number, on: boolean) => setPicked((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const setShown = (on: boolean) => setPicked((s) => { const n = new Set(s); shown.forEach((p) => (on ? n.add(p.id) : n.delete(p.id))); return n; });
  return (
    <div>
      <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
        <label className="form-label mb-0 me-auto">Facebook Pages <span className="badge bg-primary-subtle text-primary ms-1">{picked.size} of {pages.length} selected</span></label>
        {pages.length > 6 && (
          <input type="search" className="form-control form-control-sm" style={{ maxWidth: 220 }} placeholder="Search Page or client…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search Pages" />
        )}
        <button type="button" className="btn btn-sm btn-soft-primary" onClick={() => setShown(true)}>Select {term ? 'shown' : 'all'}</button>
        <button type="button" className="btn btn-sm btn-light" onClick={() => setShown(false)} disabled={!picked.size}>{term ? 'Clear shown' : 'Clear'}</button>
      </div>
      <div className="border rounded p-2" style={{ maxHeight: 240, overflowY: 'auto' }}>
        <div className="row g-1">
          {shown.map((p) => (
            <div key={p.id} className="col-sm-6 col-lg-4">
              <div className="form-check mb-0 py-1">
                <input className="form-check-input" type="checkbox" id={`fbp-${p.id}`} name="page_ids" value={p.id} checked={picked.has(p.id)} onChange={(e) => toggle(p.id, e.target.checked)} />
                <label className="form-check-label text-truncate d-block" htmlFor={`fbp-${p.id}`} title={p.client ? `${p.name} · ${p.client}` : p.name}>
                  {p.name}{p.client && <span className="small text-muted"> · {p.client}</span>}
                </label>
              </div>
            </div>
          ))}
          {!shown.length && <div className="col-12 small text-muted py-2 text-center">No Page matches “{q}”.</div>}
        </div>
      </div>
      {/* Ticked Pages hidden by the search are still sent */}
      {[...picked].filter((id) => !shown.some((p) => p.id === id)).map((id) => <input key={id} type="hidden" name="page_ids" value={id} />)}
      <FieldError name="page_ids" />
    </div>
  );
}

export function UploadPostsForm({ pages }: { pages: PickPage[] }) {
  return (
    <ActionForm action={uploadPosts}>
      <div className="mb-3"><PagePicker pages={pages} /></div>
      <div className="row g-3 align-items-start">
        <div className="col-md-6">
          <label className="form-label" htmlFor="fb-csv">CSV file</label>
          <input type="file" className="form-control" id="fb-csv" name="csv" accept=".csv,text/csv" />
          <FieldError name="csv" />
        </div>
        <div className="col-md-3">
          <label className="form-label" htmlFor="fb-start">Start <span className="text-muted fw-normal">(optional)</span></label>
          <input type="datetime-local" className="form-control" id="fb-start" name="start" />
          <FieldError name="start" />
        </div>
        <div className="col-md-3 pt-md-4">
          <SubmitButton className="btn btn-success w-100 mt-md-1" pendingText="Uploading…"><i className="ri-upload-2-line" /> Queue posts</SubmitButton>
        </div>
      </div>
    </ActionForm>
  );
}

export function AddPageForm({ clients }: { clients: { id: number; name: string }[] }) {
  return (
    <ActionForm action={addPage} resetOnSuccess>
      <div className="mb-3">
        <label className="form-label" htmlFor="fp-token">Access token <span className="text-muted fw-normal">(User, System User or Page)</span></label>
        <textarea className="form-control font-monospace small" id="fp-token" name="token" rows={3} autoComplete="off" spellCheck={false}
          placeholder="EAAB… (with pages_show_list, pages_manage_posts and pages_read_engagement)" />
        <FieldError name="token" />
      </div>
      <div className="mb-3">
        <label className="form-label" htmlFor="fp-user">Client account <span className="text-muted fw-normal">(optional, set for every Page this token connects)</span></label>
        <select className="form-select" id="fp-user" name="user_id" defaultValue="0">
          <option value="0">—</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <SubmitButton className="btn btn-primary" pendingText="Checking with Facebook…"><i className="ri-facebook-circle-line" /> Connect Pages</SubmitButton>
    </ActionForm>
  );
}

/** Reload the status every 15 s while posts are still queued / posting. */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(t);
  }, [active, router]);
  return active ? <span className="small text-muted"><span className="spinner-border spinner-border-sm me-1" />Updating every 15 seconds</span> : null;
}

/** Submit button for a plain <form action={serverAction}>: disabled with a spinner while it runs. */
export function PendingButton({ children, pendingText, className }: { children: React.ReactNode; pendingText: string; className: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? <><span className="spinner-border spinner-border-sm me-1" />{pendingText}</> : children}
    </button>
  );
}

/** Reload the server data of this page (e.g. the Uploads table) without a full page load. */
export function RefreshButton({ label = 'Refresh' }: { label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn btn-sm btn-soft-secondary" disabled={pending} onClick={() => start(() => router.refresh())} title="Reload the latest status">
      {pending ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="ri-refresh-line" />} {pending ? 'Refreshing…' : label}
    </button>
  );
}

/** A card that opens / closes on its header (closed by default). */
export function AccordionCard({ title, children, defaultOpen = false, actions }: { title: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; actions?: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card">
      <div className="card-header d-flex flex-wrap align-items-center gap-2">
        <button type="button" className="btn btn-link text-body text-decoration-none p-0 me-auto d-flex align-items-center gap-2 text-start" aria-expanded={open} onClick={() => setOpen(!open)}>
          <i className={`ri-arrow-${open ? 'down' : 'right'}-s-line fs-4 text-muted`} />
          <h5 className="card-title mb-0">{title}</h5>
        </button>
        {actions}
      </div>
      {open && <div className="card-body">{children}</div>}
    </div>
  );
}

/**
 * "Delete selected" for the Pages table: the row checkboxes belong to this form through form="fbp-bulk"
 * (the rows have their own delete forms, and forms can't be nested).
 */
export function BulkDeletePages({ action }: { action: (fd: FormData) => Promise<void> }) {
  const [count, setCount] = useState(0);
  const [problems, setProblems] = useState(0);
  useEffect(() => {
    const boxes = () => [...document.querySelectorAll<HTMLInputElement>('input[form="fbp-bulk"][name="ids"]')];
    const read = () => {
      const all = boxes();
      const n = all.filter((b) => b.checked).length;
      setCount(n);
      setProblems(all.filter((b) => b.dataset.problem === '1').length);
      const head = document.querySelector<HTMLInputElement>('#fbp-all');
      if (head) { head.checked = all.length > 0 && n === all.length; head.indeterminate = n > 0 && n < all.length; }
    };
    const onChange = (e: Event) => {
      const t = e.target as HTMLInputElement;
      if (t.id === 'fbp-all') boxes().forEach((b) => { b.checked = t.checked; });
      if (t.id === 'fbp-all' || t.getAttribute('form') === 'fbp-bulk') read();
    };
    document.addEventListener('change', onChange);
    read();
    return () => document.removeEventListener('change', onChange);
  }, []);
  const pickProblems = () => {
    const all = [...document.querySelectorAll<HTMLInputElement>('input[form="fbp-bulk"][name="ids"]')];
    all.forEach((b) => { b.checked = b.dataset.problem === '1'; });
    all[0]?.dispatchEvent(new Event('change', { bubbles: true })); // recount (a row box, not the header box)
  };
  return (
    <form id="fbp-bulk" action={action} className="d-flex flex-wrap align-items-center gap-2"
      onSubmit={(e) => { if (!count || !window.confirm(`Remove the ${count} ticked Page(s)? Their queued posts and history here are deleted (posts already on Facebook stay).`)) e.preventDefault(); }}>
      {problems > 0 && <button type="button" className="btn btn-sm btn-soft-warning" onClick={pickProblems}><i className="ri-error-warning-line" /> Select problem Pages ({problems})</button>}
      <PendingButton className="btn btn-sm btn-soft-danger" pendingText="Removing…"><i className="ri-delete-bin-line" /> Delete selected{count ? ` (${count})` : ''}</PendingButton>
    </form>
  );
}
