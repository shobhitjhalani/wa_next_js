import type { Metadata } from 'next';
import Link from 'next/link';
import { FilterSelect } from '@/components/FilterSelect';
import { PageTitle } from '@/components/PageTitle';
import { Pagination, pageParam } from '@/components/Pagination';
import { DateRangeInput } from '@/components/ui';
import { requireSuperAdmin } from '@/lib/admin-access';
import { STATUS_INFO } from '@/lib/crm';
import { one, query } from '@/lib/db';
import { pageNames } from '@/lib/services/lead-pages';
import { numberFormat } from '@/lib/text';
import { now, phpDate } from '@/lib/time';
import { MetaLeadsTabs } from '../Tabs';
import { FB_LEAD_SQL, LEAD_COLS, leadWhere, type LeadListRow, type Params } from './query';

export const metadata: Metadata = { title: 'Facebook Leads' };

const PER_PAGE = 50;

/** Every client's Facebook / Instagram leads in one list, with filters and CSV export (super admin). */
export default async function FacebookLeadsPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireSuperAdmin();
  const params = await searchParams;
  const page = pageParam(params.page);
  const { where, args, filters } = leadWhere(params);
  const n = args.length;
  const day = now() - 86400;

  const [rows, stats, clients, pageIds, forms] = await Promise.all([
    query<LeadListRow>(
      `SELECT ${LEAD_COLS} FROM js_crm_lead l JOIN js_user u ON u.u_id = l.ld_user_id
        WHERE ${where} ORDER BY l.ld_created_on DESC, l.ld_id DESC LIMIT $${n + 1} OFFSET $${n + 2}`,
      [...args, PER_PAGE, (page - 1) * PER_PAGE]),
    one<{ total: number; day: number; fresh: number; won: number; clients: number }>(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE l.ld_created_on > $${n + 1})::int AS day,
              COUNT(*) FILTER (WHERE l.ld_status = 1)::int AS fresh, COUNT(*) FILTER (WHERE l.ld_status = 4)::int AS won,
              COUNT(DISTINCT l.ld_user_id)::int AS clients
         FROM js_crm_lead l JOIN js_user u ON u.u_id = l.ld_user_id WHERE ${where}`, [...args, day]),
    query<{ u_id: number; name: string }>(
      `SELECT u.u_id, COALESCE(NULLIF(u.u_company_name, ''), NULLIF(u.u_name, ''), u.u_username::text, '#' || u.u_id) AS name
         FROM js_user u WHERE u.u_dstatus = 0 AND EXISTS (SELECT 1 FROM js_crm_lead l WHERE l.ld_user_id = u.u_id AND ${FB_LEAD_SQL})
        ORDER BY 2`),
    query<{ id: string }>(
      `SELECT DISTINCT l.ld_meta_page_id AS id FROM js_crm_lead l WHERE ${FB_LEAD_SQL} AND l.ld_meta_page_id <> ''
       UNION SELECT lp_page_id FROM js_meta_lead_page`),
    query<{ name: string }>(
      `SELECT DISTINCT l.ld_meta_form_name AS name FROM js_crm_lead l WHERE ${FB_LEAD_SQL} AND l.ld_meta_form_name <> ''
          AND ($1 = '' OR l.ld_user_id = $1::int) ORDER BY 1 LIMIT 500`, [/^\d+$/.test(filters.user_id) ? filters.user_id : '']),
  ]);
  const names = await pageNames(pageIds.map((p) => p.id));
  const pageOptions = pageIds.map((p) => ({ value: p.id, label: names.get(p.id) || `Page ${p.id}` })).sort((a, b) => a.label.localeCompare(b.label));

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
  const total = stats?.total ?? 0;
  const filtered = Object.values(filters).some(Boolean);

  return (
    <>
      <PageTitle title="Facebook Leads" home="/wamaster/dashboard" />
      <MetaLeadsTabs tab="leads" />
      <div className="row">
        {[
          ['Leads', total, 'ri-contacts-book-2-line text-primary'],
          ['Last 24 hours', stats?.day ?? 0, 'ri-time-line text-info'],
          ['Not contacted yet', stats?.fresh ?? 0, 'ri-user-unfollow-line text-warning'],
          ['Won', stats?.won ?? 0, 'ri-trophy-line text-success'],
          ['Clients', stats?.clients ?? 0, 'ri-building-line text-secondary'],
        ].map(([label, num, icon]) => (
          <div key={String(label)} className="col">
            <div className="card"><div className="card-body d-flex align-items-center gap-3">
              <i className={`${icon} fs-2`} />
              <div><p className="text-muted text-uppercase small mb-0">{label}</p><h4 className="mb-0">{numberFormat(Number(num))}</h4></div>
            </div></div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <form method="get" className="row g-2 align-items-center filter-bar">
            <div className="col-md-2"><DateRangeInput name="dt" defaultValue={filters.dt} placeholder="Received between" /></div>
            <div className="col-md-2">
              <FilterSelect name="user_id" defaultValue={filters.user_id} autoSubmit placeholder="All clients" searchPlaceholder="Search client…"
                options={[{ value: '', label: 'All clients' }, ...clients.map((c) => ({ value: String(c.u_id), label: c.name }))]} />
            </div>
            <div className="col-md-2">
              <FilterSelect name="page_id" defaultValue={filters.page_id} placeholder="All Pages" searchPlaceholder="Search Page…"
                options={[{ value: '', label: 'All Pages' }, ...pageOptions, { value: '-', label: 'Page not known' }]} />
            </div>
            <div className="col-md-2">
              <FilterSelect name="form" defaultValue={filters.form} placeholder="All forms" searchPlaceholder="Search form…"
                options={[{ value: '', label: 'All forms' }, ...forms.map((f) => ({ value: f.name, label: f.name }))]} />
            </div>
            <div className="col-md-1">
              <select className="form-select" name="status" defaultValue={filters.status} aria-label="Status">
                <option value="">Status</option>
                {Object.entries(STATUS_INFO).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
              </select>
            </div>
            <div className="col-md-1">
              <select className="form-select" name="platform" defaultValue={filters.platform} aria-label="Platform">
                <option value="">FB + IG</option><option value="fb">Facebook</option><option value="ig">Instagram</option>
              </select>
            </div>
            <div className="col-md-2"><input type="search" className="form-control" name="q" defaultValue={filters.q} placeholder="Name, mobile, email…" aria-label="Search" /></div>
            <div className="col-12 d-flex gap-2">
              <button type="submit" className="btn btn-primary btn-sm"><i className="ri-filter-3-line" /> Filter</button>
              {filtered && <Link href="/wamaster/meta_leads/leads" className="btn btn-light btn-sm">Clear</Link>}
              <a href={`/wamaster/meta_leads/leads/export${qs.size ? `?${qs}` : ''}`} className="btn btn-success btn-sm ms-auto"><i className="ri-file-excel-2-line" /> Export CSV ({numberFormat(total)})</a>
            </div>
          </form>
        </div>
        <div className="card-body p-0 table-responsive">
          <table className="table table-sm table-hover align-middle mb-0">
            <thead className="table-light">
              <tr><th>Received</th><th>Client</th><th>Page / Form</th><th>Lead</th><th>Answers</th><th>Status</th></tr>
            </thead>
            <tbody>
              {rows.map((l) => {
                const answers = Object.entries(l.ld_fields ?? {});
                const st = STATUS_INFO[l.ld_status];
                return (
                  <tr key={l.ld_id}>
                    <td className="text-nowrap small">{phpDate('d-m-Y', l.ld_created_on)}<div className="text-muted">{phpDate('h:i A', l.ld_created_on)}</div></td>
                    <td><Link href={`/wamaster/users/${l.ld_user_id}`}>{l.client || `#${l.ld_user_id}`}</Link></td>
                    <td className="small" style={{ maxWidth: 260 }}>
                      <div>
                        <i className={l.ld_platform === 'ig' || l.ld_source === 'instagram' ? 'ri-instagram-line text-danger me-1' : 'ri-facebook-circle-fill text-primary me-1'} />
                        {l.page_name || (l.ld_meta_page_id ? `Page ${l.ld_meta_page_id}` : <span className="text-muted">—</span>)}
                      </div>
                      <div className="text-muted text-truncate">{l.ld_meta_form_name || l.ld_campaign}</div>
                      {(l.ld_meta_campaign_name || l.ld_meta_ad_name) && <div className="text-muted text-truncate">Ad: {l.ld_meta_ad_name || l.ld_meta_campaign_name}</div>}
                    </td>
                    <td>
                      <div className="fw-semibold">{l.ld_name || <span className="text-muted">No name</span>}</div>
                      {l.ld_mobile && <div className="small">{l.ld_mobile}</div>}
                      {l.ld_email && <div className="small text-muted text-break">{l.ld_email}</div>}
                    </td>
                    <td className="small" style={{ maxWidth: 320 }}>
                      {answers.length === 0 ? <span className="text-muted">—</span> : (
                        <details>
                          <summary className="text-primary" style={{ cursor: 'pointer' }}>{answers.length} answer{answers.length > 1 ? 's' : ''}</summary>
                          <dl className="mb-0 mt-1">
                            {answers.map(([k, v]) => <div key={k}><dt className="d-inline fw-normal text-muted">{k.replace(/_/g, ' ')}:</dt> <dd className="d-inline mb-0">{String(v)}</dd></div>)}
                          </dl>
                        </details>
                      )}
                    </td>
                    <td>
                      {st ? <span className={`badge ${st.badge}`}>{st.label}</span> : l.ld_status}
                      {l.ld_last_followup > 0 && <div className="small text-muted">Follow-up {phpDate('d-m-Y', l.ld_last_followup)}</div>}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr><td colSpan={6} className="text-center text-muted py-5">
                  No Facebook leads{filtered ? ' for this filter' : ' yet'}. Connect Pages on <Link href="/wamaster/meta_leads/pages">Lead Pages</Link>.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="card-footer"><Pagination path="/wamaster/meta_leads/leads" params={params} page={page} perPage={PER_PAGE} total={total} /></div>
      </div>
    </>
  );
}
