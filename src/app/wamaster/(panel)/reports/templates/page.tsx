import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { campaignSummary, readSummaryFilter, STATUS_COLUMNS } from '@/lib/services/campaign-summary';
import { numberFormat } from '@/lib/text';
import { phpDate } from '@/lib/time';
import { PageTitle } from '@/components/PageTitle';
import { DateRangeInput } from '@/components/ui';
import { corporates, filled, input, intParam, waUsers, type Params } from '../_lib';

export const metadata: Metadata = { title: 'Campaign Summary' };

const TONE: Record<string, string> = { failed: 'text-danger', error: 'text-danger', queue: 'text-warning' };

/** Campaign Summary across users: each campaign's messages by status (replaces the template × status report). */
export default async function CampaignSummaryReportPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAdmin();
  const sp = await searchParams;
  const filter = readSummaryFilter(sp);
  const scope = {
    userId: filled(sp, 'user_id') ? intParam(sp, 'user_id') : null,
    parentId: filled(sp, 'parent_id') ? intParam(sp, 'parent_id') : null,
  };
  const [{ rows, totals, untracked }, allUsers, parents] = await Promise.all([campaignSummary(scope, filter), waUsers(), corporates()]);

  const qs = new URLSearchParams({ wa_date: filter.date });
  for (const k of ['q', 'user_id', 'parent_id']) if (filled(sp, k)) qs.set(k, input(sp, k) ?? '');

  return (
    <>
      <PageTitle title="Campaign Summary" home="/wamaster/dashboard" />
      <div className="card">
        <div className="card-header">
          <form method="get" className="row g-2 align-items-center filter-bar">
            <div className="col-md-3"><DateRangeInput name="wa_date" defaultValue={filter.date} placeholder="Date range" /></div>
            <div className="col-md-2">
              <select className="form-select" name="parent_id" defaultValue={input(sp, 'parent_id') ?? ''} aria-label="Corporate account">
                <option value="">All corporate accounts</option>
                {parents.map((u) => <option key={u.u_id} value={String(u.u_id)}>{u.u_name}</option>)}
              </select>
            </div>
            <div className="col-md-2">
              <select className="form-select" name="user_id" defaultValue={input(sp, 'user_id') ?? ''} aria-label="User">
                <option value="">All users</option>
                {allUsers.map((u) => <option key={u.u_id} value={String(u.u_id)}>{u.u_username}</option>)}
              </select>
            </div>
            <div className="col-md-2"><input type="text" className="form-control" name="q" defaultValue={filter.q} placeholder="Campaign / template" aria-label="Campaign or template name" /></div>
            <div className="col-auto"><button className="btn btn-secondary">Search</button></div>
            <div className="col-auto ms-auto">
              <a href={`/wamaster/reports/templates/export?${qs.toString()}`} className="btn btn-soft-info"><i className="ri-download-2-line" /> Export</a>
            </div>
          </form>
        </div>
        <div className="card-body">
          {!rows.length ? <p className="text-muted mb-0">No campaigns for this period.</p> : (
            <div className="table-responsive">
              <table className="table table-sm align-middle table-nowrap table-striped table-report mb-0">
                <thead className="table-light">
                  <tr>
                    <th>#</th>
                    <th>Date</th>
                    <th>Username</th>
                    <th>Campaign Name</th>
                    {STATUS_COLUMNS.map(([key, label]) => <th key={key} className="num">{label}</th>)}
                    <th className="num" title="Send + Delivered + Read">Total</th>
                    <th className="num" title="All messages of the campaign">Total Data</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.id}>
                      <td>{i + 1}</td>
                      <td>{phpDate('d-m-Y H:i', r.date)}</td>
                      <td><Link href={`/wamaster/users/${r.userId}`}>{r.username}</Link></td>
                      <td>
                        {r.name}
                        {r.template && r.template !== r.name && <div className="small text-muted">{r.template}</div>}
                      </td>
                      {STATUS_COLUMNS.map(([key]) => (
                        <td key={key} className={`num ${r.counts && r.counts[key] ? TONE[key] ?? '' : ''}`}>{r.counts ? numberFormat(r.counts[key]) : '—'}</td>
                      ))}
                      <th className="num">{r.counts ? numberFormat(r.counts.total) : '—'}</th>
                      <th className="num">
                        {r.counts ? numberFormat(r.counts.all) : <span title="Recipients; status not tracked for this campaign">{numberFormat(r.recipients)}*</span>}
                      </th>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="table-light">
                  <tr>
                    <th colSpan={4}>Total ({numberFormat(rows.length)} campaign{rows.length === 1 ? '' : 's'})</th>
                    {STATUS_COLUMNS.map(([key]) => <th key={key} className="num">{numberFormat(totals[key])}</th>)}
                    <th className="num">{numberFormat(totals.total)}</th>
                    <th className="num">{numberFormat(totals.all)}</th>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {untracked > 0 && (
            <p className="small text-muted mt-3 mb-0">
              * {numberFormat(untracked)} campaign(s) were sent before messages were linked to their campaign, so only their recipient count is known.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
