import '../bot_flows/flows.css';
import './crm.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DataTableControls, SortTh, queryString } from '@/components/DataTable';
import { PageTitle } from '@/components/PageTitle';
import { Pagination } from '@/components/Pagination';
import { ConfirmButton, DateRangeInput } from '@/components/ui';
import { requireCrmUser } from '@/lib/auth';
import { LEAD_STATUS, OPEN_STATUSES, sourceInfo, sourceOptions, STATUS_INFO } from '@/lib/crm';
import { customSources } from '@/lib/services/crm';
import { one, query, value } from '@/lib/db';
import { sqlDir, tableHref, tableState } from '@/lib/datatable';
import { sp } from '@/lib/http';
import { internationalise } from '@/lib/phone';
import { numberFormat } from '@/lib/text';
import { phpDate } from '@/lib/time';
import { LeadModal } from './LeadForms';
import { deleteLead, setLeadStatus } from './actions';
import { followupLabel } from './followup-label';
import { LEAD_TABS, leadFilter, tabCountsSql } from './leads-query';

export const metadata: Metadata = { title: 'Leads' };

const PATH = '/crm';

const SORTS = {
  name: "lower(NULLIF(l.ld_name, ''))",
  followup: "NULLIF(l.ld_next_followup, 0)",
  status: 'l.ld_status',
  updated: 'l.ld_updated_on',
  created: 'l.ld_created_on',
} as const;

interface Row {
  ld_id: number; ld_name: string; ld_mobile: string; ld_email: string; ld_source: string; ld_campaign: string; ld_status: number;
  ld_next_followup: number; ld_last_followup: number; ld_created_on: number; ld_updated_on: number; followups: number; last_note: string | null;
}

/** Leads CRM: leads from social media / website / webhook, their status and next follow-up. */
export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireCrmUser();
  const params = await searchParams;

  const base = leadFilter(user.u_id, {}, LEAD_TABS[6], '');
  const counts = (await one<Record<string, number>>(tabCountsSql(), base.args)) ?? {};
  // Without ?tab=, open the follow-ups due when there are any, else all open leads
  const tab = LEAD_TABS.find((t) => t.key === sp(params, 'tab')) ?? (counts.due ? LEAD_TABS[0] : LEAD_TABS[3]);
  const tableParams = { ...params, tab: tab.key };
  const defaultSort = tab.key === 'due' || tab.key === 'upcoming' ? 'followup' : 'created';
  const table = tableState(tableParams, { sorts: Object.keys(SORTS) as (keyof typeof SORTS)[], sort: defaultSort, dir: defaultSort === 'followup' ? 'asc' : 'desc' });
  const { where, args, now: at } = leadFilter(user.u_id, params, tab, table.q);

  const [rows, total, own] = await Promise.all([
    query<Row>(
      `SELECT l.ld_id, l.ld_name, l.ld_mobile, l.ld_email, l.ld_source, l.ld_campaign, l.ld_status, l.ld_next_followup, l.ld_last_followup,
              l.ld_created_on, l.ld_updated_on, f.n AS followups, f.note AS last_note
         FROM js_crm_lead l
         LEFT JOIN LATERAL (
           SELECT COUNT(*) FILTER (WHERE fu_type <> 'system')::int AS n,
                  (SELECT fu_note FROM js_crm_followup x WHERE x.fu_lead_id = l.ld_id AND x.fu_note <> '' ORDER BY x.fu_id DESC LIMIT 1) AS note
             FROM js_crm_followup WHERE fu_lead_id = l.ld_id) f ON true
        WHERE ${where}
        ORDER BY ${SORTS[table.sort]} ${sqlDir(table.dir)} NULLS LAST, l.ld_id ${sqlDir(table.dir)}
        LIMIT ${table.perPage} OFFSET ${(table.page - 1) * table.perPage}`, args),
    value<number>(`SELECT COUNT(*)::int FROM js_crm_lead l WHERE ${where}`, args),
    customSources(user.u_id),
  ]);
  const sources = sourceOptions(own);

  const th = { path: PATH, params: tableParams, state: table };
  const back = tableHref(PATH, tableParams, {});
  const filtered = !!(table.q || sp(params, 'source') || sp(params, 'created'));
  const empty: Record<string, string> = {
    due: 'No follow-ups due today. 🎉',
    upcoming: 'No follow-ups planned after today.',
    new: 'No new leads waiting for a first contact.',
    open: 'No open leads.',
    won: 'No won leads yet.',
    lost: 'No lost leads.',
    all: 'No leads yet. Add one, or connect Facebook Lead Ads / your website in CRM Settings.',
  };

  return (
    <>
      <PageTitle title="Leads" home="/dashboard" />
      <div className="card">
        <div className="card-header d-flex align-items-center flex-wrap gap-2">
          <div className="me-auto">
            <h5 className="card-title mb-0">Leads</h5>
            <p className="text-muted small mb-0">Leads from Facebook, Instagram, your website and more: follow up on time, every time.</p>
          </div>
          <a href={`/crm/export?${queryString(tableParams)}`} className="btn btn-soft-secondary"><i className="ri-download-2-line" /> Export</a>
          <Link href="/crm/settings" className="btn btn-soft-primary"><i className="ri-webhook-line" /> Webhook &amp; Facebook</Link>
          <button type="button" className="btn btn-success" data-bs-toggle="modal" data-bs-target="#add-lead"><i className="ri-add-line" /> Add Lead</button>
        </div>
        <nav className="bf-tabs" aria-label="Lead tabs">
          {LEAD_TABS.map((t) => (
            <Link key={t.key} href={tableHref(PATH, {}, { tab: t.key })} scroll={false}
              className={`bf-tab${t.key === tab.key ? ' active' : ''}`} aria-current={t.key === tab.key ? 'page' : undefined}>
              <span className={`bf-dot ${t.dot}`} />{t.label}
              <span className={`bf-count${t.key === 'due' && counts.due ? ' crm-count-due' : ''}`}>{numberFormat(counts[t.key] ?? 0)}</span>
            </Link>
          ))}
        </nav>
        <div className="card-body">
          <form className="row g-2 mb-3 align-items-end" method="get" action={PATH}>
            <input type="hidden" name="tab" value={tab.key} />
            {table.q && <input type="hidden" name="q" value={table.q} />}
            <div className="col-sm-4 col-md-3">
              <label className="form-label small text-muted mb-1" htmlFor="f-source">Source</label>
              <select className="form-select form-select-sm" id="f-source" name="source" defaultValue={sp(params, 'source')}>
                <option value="">All sources</option>
                {sources.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div className="col-sm-5 col-md-3">
              <label className="form-label small text-muted mb-1" htmlFor="f-created">Received</label>
              <DateRangeInput name="created" id="f-created" className="form-control form-control-sm" defaultValue={sp(params, 'created')} placeholder="Any date" />
            </div>
            <div className="col-auto">
              <button type="submit" className="btn btn-sm btn-primary"><i className="ri-filter-3-line" /> Filter</button>
              {filtered && <Link href={tableHref(PATH, {}, { tab: tab.key })} className="btn btn-sm btn-link">Reset</Link>}
            </div>
          </form>
          <DataTableControls path={PATH} query={queryString(tableParams)} perPage={table.perPage} q={table.q} total={total ?? 0} placeholder="Search name, mobile, email, campaign…" />
          <div className="table-responsive">
            <table className="table table-hover align-middle table-nowrap mb-0 bf-table">
              <thead className="table-light">
                <tr>
                  <SortTh {...th} column="name">Lead</SortTh>
                  <th>Source</th>
                  <SortTh {...th} column="status">Status</SortTh>
                  <SortTh {...th} column="followup">Next follow-up</SortTh>
                  <th>Last update</th>
                  <SortTh {...th} column="created" first="desc">Received</SortTh>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length ? rows.map((l) => {
                  const src = sourceInfo(l.ld_source);
                  const st = STATUS_INFO[l.ld_status] ?? STATUS_INFO[1];
                  const open = (OPEN_STATUSES as readonly number[]).includes(Number(l.ld_status));
                  const fu = followupLabel(l.ld_next_followup, at);
                  return (
                    <tr key={l.ld_id}>
                      <td>
                        <Link href={`/crm/${l.ld_id}`} className="bf-name">{l.ld_name || l.ld_mobile || l.ld_email || `Lead #${l.ld_id}`}</Link>
                        <div className="small text-muted">{[l.ld_name && l.ld_mobile, l.ld_email].filter(Boolean).join(' · ') || ' '}</div>
                      </td>
                      <td>
                        <span className="d-inline-flex align-items-center gap-1"><i className={src.icon} />{src.label}</span>
                        {l.ld_campaign && <div className="small text-muted text-truncate" style={{ maxWidth: 220 }} title={l.ld_campaign}>{l.ld_campaign}</div>}
                      </td>
                      <td><span className={`badge ${st.badge}`}>{st.label}</span></td>
                      <td className={`small ${fu.tone}`}>
                        {open ? (fu.text ? <span className={fu.tone === 'text-danger' ? 'fw-semibold' : ''}><i className="ri-alarm-line me-1" />{fu.text}</span> : <span className="text-muted">Not set</span>) : <span className="text-muted">—</span>}
                      </td>
                      <td className="small text-wrap" style={{ maxWidth: 260 }}>
                        {l.last_note ? <span className="crm-clamp" title={l.last_note}>{l.last_note}</span> : <span className="text-muted">No follow-ups yet</span>}
                        {l.followups > 0 && <div className="text-muted">{l.followups} follow-up{l.followups === 1 ? '' : 's'}{l.ld_last_followup ? ` · last ${phpDate('d M', l.ld_last_followup)}` : ''}</div>}
                      </td>
                      <td className="small">{phpDate('d M Y', l.ld_created_on)}<div className="text-muted">{phpDate('h:i A', l.ld_created_on)}</div></td>
                      <td className="text-end">
                        <div className="bf-actions">
                          <Link href={`/crm/${l.ld_id}#followup`} className="btn btn-sm btn-outline-success bf-main"><i className="ri-chat-follow-up-line align-bottom me-1" />Follow up</Link>
                          <div className="bf-icons">
                            {l.ld_mobile ? <Link href={`/chat?mb=${encodeURIComponent(l.ld_mobile)}`} title="Open WhatsApp chat" aria-label="WhatsApp"><i className="ri-whatsapp-line" /></Link> : null}
                            {l.ld_mobile ? <a href={`tel:+${internationalise(l.ld_mobile)}`} title="Call" aria-label="Call"><i className="ri-phone-line" /></a> : null}
                            {open && (
                              <form action={setLeadStatus.bind(null, l.ld_id, LEAD_STATUS.WON, back)}>
                                <button type="submit" title="Mark Won" aria-label="Mark Won"><i className="ri-trophy-line" /></button>
                              </form>
                            )}
                            <form action={deleteLead.bind(null, l.ld_id, back)}>
                              <ConfirmButton message={`Delete the lead “${l.ld_name || l.ld_mobile || l.ld_id}” and its follow-ups?`} className="bf-danger" title="Delete" aria-label="Delete">
                                <i className="ri-delete-bin-line" />
                              </ConfirmButton>
                            </form>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr><td colSpan={7} className="text-center text-muted py-5">{filtered ? 'No leads match these filters.' : empty[tab.key]}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination path={PATH} params={tableParams} page={table.page} perPage={table.perPage} total={total ?? 0} always />
        </div>
      </div>
      <LeadModal id="add-lead" sources={sources} />
    </>
  );
}
