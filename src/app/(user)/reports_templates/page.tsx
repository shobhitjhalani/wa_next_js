import type { Metadata } from 'next';
import Link from 'next/link';
import { PageTitle } from '@/components/PageTitle';
import { DateRangeInput } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { numberFormat } from '@/lib/text';
import { phpDate } from '@/lib/time';
import { campaignSummary, readSummaryFilter, STATUS_COLUMNS } from './summary';

export const metadata: Metadata = { title: 'Campaign Summary' };

const TONE: Record<string, string> = { failed: 'text-danger', error: 'text-danger', queue: 'text-warning' };

/** Campaign Summary report: messages of each campaign by status (replaces the template × status report). */
export default async function CampaignSummaryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const params = await searchParams;
  const filter = readSummaryFilter(params);
  const { rows, totals, untracked } = await campaignSummary(user.u_id, filter);
  const qs = new URLSearchParams({ wa_date: filter.date, ...(filter.q ? { q: filter.q } : {}) }).toString();

  return (
    <>
      <PageTitle title="Campaign Summary" home="/dashboard" />
      <div className="card">
        <div className="card-header">
          <form method="get" className="row g-2 align-items-center filter-bar">
            <div className="col-md-3"><DateRangeInput name="wa_date" defaultValue={filter.date} placeholder="Date range" /></div>
            <div className="col-md-3"><input type="text" className="form-control" name="q" defaultValue={filter.q} placeholder="Campaign or template name" aria-label="Campaign or template name" /></div>
            <div className="col-auto"><button type="submit" className="btn btn-secondary">Search</button></div>
            <div className="col-auto ms-auto">
              <a href={`/reports_templates/export?${qs}`} className="btn btn-soft-info"><i className="ri-download-2-line" /> Export</a>
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
                      <td>
                        <Link href={`/campaigns/${r.id}`}>{r.name}</Link>
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
                    <th colSpan={3}>Total ({numberFormat(rows.length)} campaign{rows.length === 1 ? '' : 's'})</th>
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
