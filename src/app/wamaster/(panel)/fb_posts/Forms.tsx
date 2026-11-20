'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { ActionForm, FieldError, SubmitButton } from '@/components/ActionForm';
import { addPage, uploadPosts } from './actions';

export interface PickPage { id: number; name: string; client: string | null; tags: string[] }

/** A chosen tag chip: solid (the theme fades buttons marked aria-pressed). */
const ON = { background: 'var(--vz-primary)', borderColor: 'var(--vz-primary)', color: '#fff' } as const;

/** Tick the Pages to post to: filter by tags and search by Page or client name, select all shown / none. */
function PagePicker({ pages }: { pages: PickPage[] }) {
  const [picked, setPicked] = useState<Set<number>>(() => new Set(pages.length === 1 ? [pages[0].id] : []));
  const [q, setQ] = useState('');
  const [tags, setTags] = useState<Set<string>>(new Set());
  // Every tag once (any case), with how many Pages have it
  const tagCounts = new Map<string, { label: string; n: number }>();
  for (const p of pages) for (const t of p.tags) {
    const k = t.toLowerCase();
    const c = tagCounts.get(k) ?? { label: t, n: 0 };
    c.n++;
    tagCounts.set(k, c);
  }
  const allTags = [...tagCounts.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label));
  const untagged = pages.filter((p) => !p.tags.length).length;
  const term = q.trim().toLowerCase();
  const shown = pages.filter((p) =>
    (!tags.size || (tags.has('') && !p.tags.length) || p.tags.some((t) => tags.has(t.toLowerCase())))
    && (!term || `${p.name} ${p.client ?? ''} ${p.tags.join(' ')}`.toLowerCase().includes(term)));
  const filtered = !!term || tags.size > 0;
  const toggle = (id: number, on: boolean) => setPicked((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const setShown = (on: boolean) => setPicked((s) => { const n = new Set(s); shown.forEach((p) => (on ? n.add(p.id) : n.delete(p.id))); return n; });
  const flipTag = (k: string) => setTags((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return (
    <div>
      <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
        <label className="form-label mb-0 me-auto">Facebook Pages <span className="badge bg-primary-subtle text-primary ms-1">{picked.size} of {pages.length} selected</span></label>
        {pages.length > 6 && (
          <input type="search" className="form-control form-control-sm" style={{ maxWidth: 220 }} placeholder="Search Page, client or tag…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search Pages" />
        )}
        <button type="button" className="btn btn-sm btn-soft-primary" onClick={() => setShown(true)} disabled={!shown.length}>Select {filtered ? `shown (${shown.length})` : 'all'}</button>
        <button type="button" className="btn btn-sm btn-light" onClick={() => setShown(false)} disabled={!picked.size}>{filtered ? 'Clear shown' : 'Clear'}</button>
      </div>
      {allTags.length > 0 && (
        <div className="d-flex flex-wrap align-items-center gap-1 mb-2" role="group" aria-label="Filter by tag">
          <span className="small text-muted me-1"><i className="ri-price-tag-3-line" /> Tags:</span>
          {allTags.map(([k, t]) => (
            <button key={k} type="button" aria-pressed={tags.has(k)} onClick={() => flipTag(k)} style={tags.has(k) ? ON : undefined}
              className={`btn btn-sm rounded-pill py-0 ${tags.has(k) ? 'btn-primary' : 'btn-outline-primary'}`}>{t.label} <span className="opacity-75">{t.n}</span></button>
          ))}
          {untagged > 0 && (
            <button type="button" aria-pressed={tags.has('')} onClick={() => flipTag('')} style={tags.has('') ? { ...ON, background: 'var(--vz-secondary)', borderColor: 'var(--vz-secondary)' } : undefined}
              className={`btn btn-sm rounded-pill py-0 ${tags.has('') ? 'btn-secondary' : 'btn-outline-secondary'}`}>No tag <span className="opacity-75">{untagged}</span></button>
          )}
          {tags.size > 0 && <button type="button" className="btn btn-sm btn-link py-0" onClick={() => setTags(new Set())}>Show all</button>}
        </div>
      )}
      <div className="border rounded p-2" style={{ maxHeight: 240, overflowY: 'auto' }}>
        <div className="row g-1">
          {shown.map((p) => (
            <div key={p.id} className="col-sm-6 col-lg-4">
              <div className="form-check mb-0 py-1">
                <input className="form-check-input" type="checkbox" id={`fbp-${p.id}`} name="page_ids" value={p.id} checked={picked.has(p.id)} onChange={(e) => toggle(p.id, e.target.checked)} />
                <label className="form-check-label text-truncate d-block" htmlFor={`fbp-${p.id}`} title={[p.name, p.client, p.tags.join(', ')].filter(Boolean).join(' · ')}>
                  {p.name}{p.client && <span className="small text-muted"> · {p.client}</span>}
                  {p.tags.length > 0 && <span className="small text-info"> · {p.tags.join(', ')}</span>}
                </label>
              </div>
            </div>
          ))}
          {!shown.length && <div className="col-12 small text-muted py-2 text-center">No Page matches{term ? ` “${q}”` : ''}{tags.size ? ' the chosen tags' : ''}.</div>}
        </div>
      </div>
      {/* Ticked Pages hidden by the search / tag filter are still sent */}
      {[...picked].filter((id) => !shown.some((p) => p.id === id)).map((id) => <input key={id} type="hidden" name="page_ids" value={id} />)}
      {filtered && picked.size > [...picked].filter((id) => shown.some((p) => p.id === id)).length && (
        <div className="small text-muted mt-1">{picked.size - [...picked].filter((id) => shown.some((p) => p.id === id)).length} selected Page(s) are hidden by the filter and still get the posts.</div>
      )}
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
          <SubmitButton className="btn btn-success w-100 mt-md-1" pendingText="Uploading…"><i className="ri-eye-line" /> Upload &amp; preview</SubmitButton>
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
export function BulkDeletePages({ action, tagAction, tags }: { action: (fd: FormData) => Promise<void>; tagAction: (fd: FormData) => Promise<void>; tags: string[] }) {
  const [count, setCount] = useState(0);
  const [problems, setProblems] = useState(0);
  const [tag, setTag] = useState('');
  // Which button submitted: set on click (before the submit event), also sent as the hidden "mode" field
  const modeRef = useRef<HTMLInputElement>(null);
  const setMode = (m: string) => { if (modeRef.current) modeRef.current.value = m; };
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
      onSubmit={(e) => {
        const isTag = modeRef.current?.value !== 'delete';
        if (!count) { e.preventDefault(); window.alert('Tick the Pages first.'); return; }
        if (isTag && !tag.trim()) { e.preventDefault(); window.alert('Type the tag first.'); return; }
        if (!isTag && !window.confirm(`Remove the ${count} ticked Page(s)? Their queued posts and history here are deleted (posts already on Facebook stay).`)) e.preventDefault();
      }}>
      {problems > 0 && <button type="button" className="btn btn-sm btn-soft-warning" onClick={pickProblems}><i className="ri-error-warning-line" /> Select problem Pages ({problems})</button>}
      <input type="hidden" name="mode" ref={modeRef} defaultValue="add" />
      <div className="input-group input-group-sm" style={{ width: 'auto' }}>
        <span className="input-group-text"><i className="ri-price-tag-3-line" /></span>
        <input name="tag" className="form-control" style={{ maxWidth: 150 }} list="fbp-tag-list" placeholder="Tag" value={tag} onChange={(e) => setTag(e.target.value)} maxLength={40} aria-label="Tag for the ticked Pages"
          onKeyDown={(e) => { if (e.key === 'Enter') setMode('add'); }} />
        <button type="submit" formAction={tagAction} onClick={() => setMode('add')} className="btn btn-soft-info" title="Add this tag to the ticked Pages">Add tag{count ? ` (${count})` : ''}</button>
        <button type="submit" formAction={tagAction} onClick={() => setMode('remove')} className="btn btn-soft-secondary" title="Take this tag off the ticked Pages">Remove</button>
      </div>
      <datalist id="fbp-tag-list">{tags.map((t) => <option key={t} value={t} />)}</datalist>
      <span onClickCapture={() => setMode('delete')}>
        <PendingButton className="btn btn-sm btn-soft-danger" pendingText="Working…"><i className="ri-delete-bin-line" /> Delete selected{count ? ` (${count})` : ''}</PendingButton>
      </span>
    </form>
  );
}

/** A Page's tags with an inline editor (comma separated). */
export function PageTags({ tags, action }: { tags: string[]; action: (fd: FormData) => Promise<void> }) {
  const [edit, setEdit] = useState(false);
  if (!edit) {
    return (
      <div className="d-flex flex-wrap align-items-center gap-1 mt-1">
        {tags.map((t) => <span key={t} className="badge bg-info-subtle text-info fw-normal">{t}</span>)}
        <button type="button" className="btn btn-link btn-sm p-0 small text-muted" onClick={() => setEdit(true)} title="Edit tags">
          <i className={tags.length ? 'ri-pencil-line' : 'ri-price-tag-3-line'} />{!tags.length && ' Add tags'}
        </button>
      </div>
    );
  }
  return (
    <form action={async (fd) => { await action(fd); setEdit(false); }} className="d-flex gap-1 mt-1" style={{ maxWidth: 320 }}>
      <input name="tags" className="form-control form-control-sm" defaultValue={tags.join(', ')} placeholder="e.g. Jaipur, Tata, Premium" autoFocus list="fbp-tag-list" aria-label="Tags, comma separated"
        onKeyDown={(e) => { if (e.key === 'Escape') setEdit(false); }} />
      <PendingButton className="btn btn-sm btn-primary" pendingText="…"><i className="ri-check-line" /></PendingButton>
      <button type="button" className="btn btn-sm btn-light" onClick={() => setEdit(false)} aria-label="Cancel"><i className="ri-close-line" /></button>
    </form>
  );
}
