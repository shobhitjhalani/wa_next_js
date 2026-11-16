'use client';

import { useEffect, useRef, useState } from 'react';
import type { GroupContactsPage } from '../groups/[id]/contacts/route';

/** Popup with the contacts of one group (search + paging), opened from the compose group list. */
export function GroupContactsModal({ groupId, name, onClose }: { groupId: number; name: string; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<GroupContactsPage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
      clearTimeout(timer.current);
    };
  }, [onClose]);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError('');
    const qs = new URLSearchParams({ page: String(page) });
    if (search) qs.set('q', search);
    fetch(`/groups/${groupId}/contacts?${qs}`, { signal: ctrl.signal, headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((res: GroupContactsPage) => { setData(res); setLoading(false); })
      .catch((e) => { if (!ctrl.signal.aborted) { setError('Could not load contacts.'); setLoading(false); } return e; });
    return () => ctrl.abort();
  }, [groupId, page, search]);

  const total = data?.total ?? 0;
  const perPage = data?.perPage ?? 50;
  const last = Math.max(1, Math.ceil(total / perPage));
  const from = total ? (page - 1) * perPage + 1 : 0;
  const to = Math.min(total, page * perPage);

  return (
    <>
      <div className="modal fade show d-block" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="group_contacts_title" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="modal-dialog modal-dialog-centered modal-dialog-scrollable modal-fullscreen-sm-down">
          <div className="modal-content">
            <div className="modal-header">
              <div className="text-truncate">
                <h5 className="modal-title text-truncate" id="group_contacts_title">{name}</h5>
                <div className="small text-muted">{data ? `${total.toLocaleString('en-US')} contact${total === 1 ? '' : 's'}${search ? ' match' : ''}` : ' '}</div>
              </div>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
            </div>
            <div className="modal-body">
              <div className="position-relative mb-3">
                <i className="ri-search-line position-absolute top-50 translate-middle-y ms-2 text-muted" aria-hidden />
                <input
                  type="search" className="form-control form-control-sm ps-4" placeholder="Search name or mobile" aria-label="Search contacts" value={q} autoFocus maxLength={100}
                  onChange={(e) => {
                    const v = e.target.value;
                    setQ(v);
                    clearTimeout(timer.current);
                    timer.current = setTimeout(() => { setPage(1); setSearch(v.trim()); }, 300);
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); /* don't submit the compose form */ }}
                />
              </div>
              {error ? <p className="text-danger small mb-0">{error}</p> : (
                <div className={loading ? 'opacity-50' : ''}>
                  {data && !data.rows.length && !loading ? (
                    <p className="text-muted small mb-0">{search ? 'No contacts match this search.' : 'This group has no contacts.'}</p>
                  ) : (
                    <table className="table table-sm align-middle mb-0">
                      <thead className="table-light"><tr><th>#</th><th>Name</th><th>Mobile</th><th /></tr></thead>
                      <tbody>
                        {(data?.rows ?? []).map((c, i) => (
                          <tr key={c.id}>
                            <td className="text-muted small">{from + i}</td>
                            <td>{c.name || <span className="text-muted">—</span>}</td>
                            <td className="text-nowrap">{c.mobile}</td>
                            <td>{c.optOut && <span className="badge bg-danger-subtle text-danger" title="Will not receive messages">Opted out</span>}</td>
                          </tr>
                        ))}
                        {!data && <tr><td colSpan={4} className="text-center text-muted py-3"><span className="spinner-border spinner-border-sm" role="status" aria-label="Loading" /></td></tr>}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
            <div className="modal-footer justify-content-between">
              <span className="small text-muted">{total ? `Showing ${from.toLocaleString('en-US')} to ${to.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}` : ''}</span>
              <div className="btn-group btn-group-sm">
                <button type="button" className="btn btn-light border" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">&lsaquo; Prev</button>
                <button type="button" className="btn btn-light border" disabled={page >= last || loading} onClick={() => setPage((p) => p + 1)} aria-label="Next page">Next &rsaquo;</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="modal-backdrop fade show" />
    </>
  );
}
