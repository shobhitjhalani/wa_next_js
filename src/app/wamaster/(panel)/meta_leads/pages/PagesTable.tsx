'use client';

import { useMemo, useState } from 'react';
import { SearchSelect, type SearchOption } from '@/components/SearchSelect';
import { ConfirmButton } from '@/components/ui';
import { removeLeadPage, saveLeadPage } from './actions';

export interface PageRow {
  id: string; name: string; category: string;
  /** From the Meta token (else only saved / seen in leads). */
  inToken: boolean;
  saved: boolean; userId: number; client: string | null; subscribed: boolean; error: string;
  /** Only leads of ads in these ad accounts ([] = every lead of the Page). */
  adAccounts: string[];
  recent: number; waiting: number; filtered: number;
}

export interface AdAccountOption { id: string; name: string; active: boolean }

function Row({ p, clients, accounts }: { p: PageRow; clients: SearchOption[]; accounts: AdAccountOption[] }) {
  const [userId, setUserId] = useState(p.userId ? String(p.userId) : '');
  const [picked, setPicked] = useState<string[]>(p.adAccounts);
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const changed = !p.saved || userId !== (p.userId ? String(p.userId) : '') || !same(picked, p.adAccounts);
  // Saved accounts the token no longer lists still show (and stay ticked)
  const options = [...accounts, ...p.adAccounts.filter((id) => !accounts.some((a) => a.id === id)).map((id) => ({ id, name: '', active: false }))];
  const label = (id: string) => { const a = options.find((x) => x.id === id); return a?.name ? a.name : `act_${id}`; };
  return (
    <tr>
      <td style={{ minWidth: 220 }}>
        <div className="fw-semibold">{p.name || <span className="text-muted">Unknown Page</span>}</div>
        <div className="small text-muted">
          {p.id}{p.category ? ` · ${p.category}` : ''}{' '}
          <a href={`https://www.facebook.com/${p.id}`} target="_blank" rel="noreferrer"><i className="ri-external-link-line" /></a>
        </div>
        {!p.inToken && <div className="small text-warning">The Meta token can&apos;t reach this Page</div>}
      </td>
      <td style={{ minWidth: 260 }}>
        <form action={saveLeadPage} className="d-flex gap-2 align-items-start">
          <input type="hidden" name="page_id" value={p.id} />
          <input type="hidden" name="page_name" value={p.name} />
          <div className="flex-grow-1">
            <SearchSelect name="user_id" value={userId} onChange={setUserId} options={clients} placeholder="Choose client" searchPlaceholder="Search client…" />
            {picked.map((id) => <input key={id} type="hidden" name="ad_accounts" value={id} />)}
            <details className="mt-1 small">
              <summary className={picked.length ? 'text-primary' : 'text-muted'} style={{ cursor: 'pointer' }}>
                {picked.length ? <>Only ads of: {picked.map(label).join(', ')}</> : 'All leads of the Page (any ad account, organic too)'}
              </summary>
              <div className="border rounded p-2 mt-1" style={{ maxHeight: 200, overflowY: 'auto' }}>
                {options.length === 0 && <div className="text-muted">The Meta token can&apos;t see any ad account.</div>}
                {options.map((a) => (
                  <div key={a.id} className="form-check">
                    <input className="form-check-input" type="checkbox" id={`aa_${p.id}_${a.id}`} checked={picked.includes(a.id)}
                      onChange={(e) => setPicked(e.target.checked ? [...picked, a.id] : picked.filter((x) => x !== a.id))} />
                    <label className="form-check-label" htmlFor={`aa_${p.id}_${a.id}`}>
                      {a.name || <span className="text-muted">Not listed by the token</span>} <span className="text-muted">act_{a.id}</span>
                      {!a.active && a.name && <span className="badge bg-light text-muted ms-1">inactive</span>}
                    </label>
                  </div>
                ))}
                <div className="text-muted mt-1">Tick your agency ad account(s): leads of the client&apos;s own ads and organic leads are then skipped. None ticked = every lead.</div>
              </div>
            </details>
          </div>
          <button type="submit" className={`btn btn-sm ${changed ? 'btn-primary' : 'btn-light'}`} title={p.saved ? 'Save and re-subscribe' : 'Connect'}>
            {p.saved ? (changed ? 'Save' : <i className="ri-refresh-line" />) : 'Connect'}
          </button>
        </form>
      </td>
      <td>
        {!p.saved ? <span className="badge bg-light text-muted">Not connected</span>
          : p.subscribed ? <span className="badge bg-success-subtle text-success">Receiving leads</span>
            : <span className="badge bg-danger-subtle text-danger">Not subscribed</span>}
        {p.saved && !p.userId && <div><span className="badge bg-warning-subtle text-warning mt-1">No client</span></div>}
        {p.error && <div className="small text-danger mt-1 text-break" style={{ maxWidth: 320 }}>{p.error}</div>}
      </td>
      <td className="text-end">{p.recent || '—'}</td>
      <td className="text-end">{p.waiting ? <span className="badge bg-warning text-dark">{p.waiting}</span> : '—'}</td>
      <td className="text-end text-muted" title="Leads of other ad accounts / organic, last 30 days">{p.filtered || '—'}</td>
      <td className="text-end">
        {p.saved && (
          <form action={removeLeadPage}>
            <input type="hidden" name="page_id" value={p.id} />
            <ConfirmButton message={`Stop filing leads of ${p.name || p.id}?`} className="btn btn-sm btn-soft-danger" title="Disconnect"><i className="ri-link-unlink" /></ConfirmButton>
          </form>
        )}
      </td>
    </tr>
  );
}

/** Lead Pages table: one row per Page, client picker + connect, with a search box over Page names / clients. */
export function PagesTable({ pages, clients, accounts }: { pages: PageRow[]; clients: SearchOption[]; accounts: AdAccountOption[] }) {
  const [q, setQ] = useState('');
  const [show, setShow] = useState<'all' | 'connected' | 'waiting'>('all');
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return pages.filter((p) => (show === 'all' || (show === 'connected' ? p.saved : p.waiting > 0))
      && (!t || `${p.name} ${p.id} ${p.client ?? ''}`.toLowerCase().includes(t)));
  }, [pages, q, show]);
  return (
    <>
      <div className="card-header d-flex flex-wrap gap-2 align-items-center">
        <input type="search" className="form-control" style={{ maxWidth: 280 }} placeholder="Search Page or client…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        <div className="btn-group btn-group-sm" role="group">
          {(['all', 'connected', 'waiting'] as const).map((k) => (
            <button key={k} type="button" className={`btn ${show === k ? 'btn-primary' : 'btn-light'}`} onClick={() => setShow(k)}>
              {k === 'all' ? `All (${pages.length})` : k === 'connected' ? `Connected (${pages.filter((p) => p.saved).length})` : `Leads waiting (${pages.filter((p) => p.waiting > 0).length})`}
            </button>
          ))}
        </div>
      </div>
      <div className="card-body p-0 table-responsive">
        <table className="table table-sm align-middle mb-0">
          <thead className="table-light">
            <tr><th>Facebook Page</th><th>Leads go to (client)</th><th>Status</th><th className="text-end">Leads 30 days</th><th className="text-end">Waiting</th><th className="text-end">Skipped 30 days</th><th /></tr>
          </thead>
          <tbody>
            {shown.map((p) => <Row key={p.id} p={p} clients={clients} accounts={accounts} />)}
            {!shown.length && <tr><td colSpan={7} className="text-center text-muted py-4">No Pages.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
