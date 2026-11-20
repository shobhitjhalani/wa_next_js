import type { Metadata } from 'next';
import Link from 'next/link';
import { PageTitle } from '@/components/PageTitle';
import { Pagination } from '@/components/Pagination';
import { DateRangeInput } from '@/components/ui';
import { ACTIVITY_MODULES } from '@/lib/activity';
import { requireSuperAdmin } from '@/lib/admin-access';
import { like, query, value } from '@/lib/db';
import { sp } from '@/lib/http';
import { numberFormat } from '@/lib/text';
import { parseDateRange, phpDate } from '@/lib/time';

export const metadata: Metadata = { title: 'Activity Log' };

const PATH = '/wamaster/activity';
const PER_PAGE = 50;

interface Row {
  aa_id: number; aa_emp_id: number; aa_emp_name: string; aa_module: string; aa_action: string; aa_target: string;
  aa_details: string[]; aa_ip: string; aa_agent: string; aa_on: number; emp_m_type: number | null;
}

const MODULE_BADGE: Record<string, string> = {
  auth: 'bg-secondary-subtle text-secondary', users: 'bg-primary-subtle text-primary', recharge: 'bg-success-subtle text-success',
  teams: 'bg-warning-subtle text-warning', exports: 'bg-info-subtle text-info', meta_leads: 'bg-danger-subtle text-danger',
};

/** Browser + OS from the user agent ("Chrome · Windows"). */
function device(ua: string): string {
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return [b, os].filter(Boolean).join(' · ');
}

/** What staff did in the admin panel: sign-ins (with IP), saves, deletes, exports. Super admins only. */
export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireSuperAdmin();
  const params = await searchParams;
  const emp = sp(params, 'emp');
  const mod = sp(params, 'module');
  const ip = sp(params, 'ip').trim();
  const q = sp(params, 'q').trim();
  const dates = sp(params, 'date');
  const range = parseDateRange(dates);
  const page = Math.max(1, parseInt(sp(params, 'page'), 10) || 1);

  const args: unknown[] = [/^-?\d+$/.test(emp) ? Number(emp) : null, mod || null, ip ? `${like(ip)}%` : null, q ? `%${like(q)}%` : null, range?.[0] ?? null, range?.[1] ?? null];
  const where = `($1::int IS NULL OR a.aa_emp_id = $1) AND ($2::text IS NULL OR a.aa_module = $2) AND ($3::text IS NULL OR a.aa_ip LIKE $3)
    AND ($4::text IS NULL OR a.aa_action ILIKE $4 OR a.aa_target ILIKE $4 OR a.aa_emp_name ILIKE $4 OR array_to_string(a.aa_details, ' ') ILIKE $4)
    AND ($5::int IS NULL OR a.aa_on >= $5) AND ($6::int IS NULL OR a.aa_on < $6)`;
  const [rows, total, people, members] = await Promise.all([
    query<Row>(
      `SELECT a.*, e.emp_m_type FROM js_admin_activity a LEFT JOIN js_employee e ON e.emp_id = a.aa_emp_id
        WHERE ${where} ORDER BY a.aa_id DESC LIMIT ${PER_PAGE} OFFSET ${(page - 1) * PER_PAGE}`, args),
    value<number>(`SELECT COUNT(*)::int FROM js_admin_activity a WHERE ${where}`, args),
    query<{ emp_id: number; emp_name: string }>(
      `SELECT DISTINCT ON (aa_emp_id) aa_emp_id AS emp_id, aa_emp_name AS emp_name FROM js_admin_activity WHERE aa_emp_id > 0 ORDER BY aa_emp_id, aa_id DESC`),
    // Each staff member: last sign-in (when, IP) and the IPs used in the last 30 days
    query<{ emp_id: number; emp_name: string; emp_m_type: number; emp_status: number; last_in: number | null; last_ip: string | null; ips: string[] | null; actions: number }>(
      `SELECT e.emp_id, e.emp_name, e.emp_m_type, e.emp_status, s.aa_on AS last_in, s.aa_ip AS last_ip,
              (SELECT array_agg(DISTINCT x.aa_ip) FROM js_admin_activity x WHERE x.aa_emp_id = e.emp_id AND x.aa_ip <> '' AND x.aa_on > extract(epoch FROM now())::int - 30 * 86400) AS ips,
              (SELECT COUNT(*)::int FROM js_admin_activity x WHERE x.aa_emp_id = e.emp_id AND x.aa_module <> 'auth' AND x.aa_on > extract(epoch FROM now())::int - 30 * 86400) AS actions
         FROM js_employee e
         LEFT JOIN LATERAL (SELECT aa_on, aa_ip FROM js_admin_activity WHERE aa_emp_id = e.emp_id AND aa_action = 'Signed in' ORDER BY aa_id DESC LIMIT 1) s ON true
        WHERE e.emp_dstatus = 0 ORDER BY s.aa_on DESC NULLS LAST, lower(e.emp_name)`),
  ]);
  const failed = await value<number>(`SELECT COUNT(*)::int FROM js_admin_activity WHERE aa_action = 'Failed sign-in' AND aa_on > extract(epoch FROM now())::int - 86400`);
  const filtered = !!(emp || mod || ip || q || dates);
  const link = (extra: Record<string, string>) => `${PATH}?${new URLSearchParams(extra)}`;

  return (
    <>
      <PageTitle title="Activity Log" home="/wamaster/dashboard" />

      <div className="card">
        <div className="card-header d-flex align-items-center">
          <h5 className="card-title mb-0 me-auto"><i className="ri-shield-user-line me-1" />Team members: sign-ins and IP addresses</h5>
          {failed ? <Link href={link({ q: 'Failed sign-in' })} className="badge bg-danger-subtle text-danger fs-12">{failed} failed sign-in(s) in 24 h</Link> : null}
        </div>
        <div className="card-body table-responsive p-0">
          <table className="table table-sm align-middle mb-0">
            <thead className="table-light"><tr><th>Member</th><th>Last sign-in</th><th>Last IP</th><th>IPs (30 days)</th><th className="text-end">Actions (30 days)</th><th /></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.emp_id} className={m.emp_status === 1 ? '' : 'text-muted'}>
                  <td><span className="fw-semibold">{m.emp_name}</span>{m.emp_m_type === 4 && <span className="badge bg-dark-subtle text-dark ms-1">Super admin</span>}{m.emp_status !== 1 && <span className="badge bg-light text-muted ms-1">Inactive</span>}</td>
                  <td className="small text-nowrap">{m.last_in ? phpDate('d M Y, h:i A', m.last_in) : <span className="text-muted">—</span>}</td>
                  <td className="font-monospace small">{m.last_ip ? <Link href={link({ ip: m.last_ip })}>{m.last_ip}</Link> : '—'}</td>
                  <td className="small">
                    {(m.ips ?? []).slice(0, 6).map((x) => <Link key={x} href={link({ ip: x })} className="badge bg-light text-body border font-monospace fw-normal me-1">{x}</Link>)}
                    {(m.ips?.length ?? 0) > 6 && <span className="text-muted">+{m.ips!.length - 6}</span>}
                  </td>
                  <td className="text-end">{numberFormat(m.actions)}</td>
                  <td className="text-end"><Link href={link({ emp: String(m.emp_id) })} className="btn btn-sm btn-soft-primary">View log</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <form method="get" className="row g-2 align-items-center filter-bar">
            <div className="col-md-3"><DateRangeInput name="date" defaultValue={dates} placeholder="Date range" /></div>
            <div className="col-md-2">
              <select className="form-select" name="emp" defaultValue={emp} aria-label="Member">
                <option value="">All members</option>
                {people.map((p) => <option key={p.emp_id} value={p.emp_id}>{p.emp_name}</option>)}
              </select>
            </div>
            <div className="col-md-2">
              <select className="form-select" name="module" defaultValue={mod} aria-label="Section">
                <option value="">All sections</option>
                {Object.entries(ACTIVITY_MODULES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="col-md-2"><input className="form-control font-monospace" name="ip" defaultValue={ip} placeholder="IP address" aria-label="IP address" /></div>
            <div className="col-md-2"><input className="form-control" name="q" defaultValue={q} placeholder="Search action, record…" aria-label="Search" /></div>
            <div className="col-auto d-flex gap-1">
              <button className="btn btn-secondary">Search</button>
              {filtered && <Link href={PATH} className="btn btn-light">Clear</Link>}
            </div>
          </form>
        </div>
        <div className="card-body table-responsive p-0">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light"><tr><th style={{ width: 150 }}>When</th><th>Who</th><th>Section</th><th>What</th><th style={{ width: 160 }}>IP / device</th></tr></thead>
            <tbody>
              {rows.length ? rows.map((r) => (
                <tr key={r.aa_id}>
                  <td className="small text-nowrap">{phpDate('d M Y', r.aa_on)}<div className="text-muted">{phpDate('h:i:s A', r.aa_on)}</div></td>
                  <td>
                    {r.aa_emp_id ? <Link href={link({ emp: String(r.aa_emp_id) })} className="fw-semibold text-body">{r.aa_emp_name}</Link> : <span className="fw-semibold">{r.aa_emp_name}</span>}
                    {r.emp_m_type === 4 && <div className="small text-muted">Super admin</div>}
                  </td>
                  <td><Link href={link({ module: r.aa_module })} className={`badge ${MODULE_BADGE[r.aa_module] ?? 'bg-light text-body border'}`}>{ACTIVITY_MODULES[r.aa_module] ?? r.aa_module}</Link></td>
                  <td style={{ minWidth: 280 }}>
                    <span className={r.aa_action === 'Failed sign-in' ? 'text-danger fw-semibold' : 'fw-medium'}>{r.aa_action}</span>
                    {r.aa_target && <> · <span>{r.aa_target}</span></>}
                    {r.aa_details.length > 0 && (
                      <ul className="small text-muted mb-0 ps-3 mt-1">
                        {r.aa_details.slice(0, 8).map((d, i) => <li key={i} className="text-break">{d}</li>)}
                        {r.aa_details.length > 8 && (
                          <li className="list-unstyled"><details><summary className="text-primary" style={{ cursor: 'pointer' }}>{r.aa_details.length - 8} more</summary>
                            <ul className="ps-3">{r.aa_details.slice(8).map((d, i) => <li key={i} className="text-break">{d}</li>)}</ul></details></li>
                        )}
                      </ul>
                    )}
                  </td>
                  <td className="small">
                    {r.aa_ip ? <Link href={link({ ip: r.aa_ip })} className="font-monospace">{r.aa_ip}</Link> : '—'}
                    <div className="text-muted" title={r.aa_agent}>{device(r.aa_agent)}</div>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={5} className="text-center text-muted py-5">{filtered ? 'Nothing matches these filters.' : 'No activity recorded yet.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="card-footer">
          <Pagination path={PATH} params={params} page={page} perPage={PER_PAGE} total={total ?? 0} always />
        </div>
      </div>
    </>
  );
}
