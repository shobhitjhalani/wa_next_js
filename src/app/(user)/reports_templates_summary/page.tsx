import type { Metadata } from 'next';
import Link from 'next/link';
import { DataTableControls, DataTableHidden, SortTh, queryString } from '@/components/DataTable';
import { PageTitle } from '@/components/PageTitle';
import { Pagination } from '@/components/Pagination';
import { DateRangeInput } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { sortRows, tableState } from '@/lib/datatable';
import { campaignSummary, readSummaryFilter, type SummaryRow } from '@/lib/services/campaign-summary';
import { numberFormat } from '@/lib/text';
import { phpDate } from '@/lib/time';

export const metadata: Metadata = { title: 'Campaign Total Summary' };

const PATH = '/reports_templates_summary';
/** Delivered to WhatsApp: Send + Delivered + Read (null for campaigns sent before messages were linked). */
const total = (r: SummaryRow) => (r.counts ? r.counts.total : null);
const SORTS: Record<string, (r: SummaryRow) => string | number | null> = { date: (r) => r.date, name: (r) => r.name, total };
const TABLE = { sorts: Object.keys(SORTS), sort: 'date', dir: 'desc' as const, perPage: 25 };

/** Short Campaign Summary: date, campaign and its total (Send + Delivered + Read). */
export default async function CampaignTotalPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const params = await searchParams;
  const filter = readSummaryFilter(params);
  const { rows: all, totals } = await campaignSummary({ userId: user.u_id }, filter);
  const table = tableState(params, TABLE);
  const offset = (table.page - 1) * table.perPage;
  const sorted = table.sort === 'date' && table.dir === 'desc' ? all : sortRows(all, SORTS[table.sort], table.dir);
  const rows = sorted.slice(offset, offset + table.perPage);
  const th = { path: PATH, params, state: table };
  const qs = new URLSearchParams({ wa_date: filter.date, ...(filter.q ? { q: filter.q } : {}) }).toString();

  return (
    <>
      <PageTitle title="Campaign Total Summary" home="/dashboard" />
      <div className="row">
        {([['Campaigns', all.length], ['Total (Send + Delivered + Read)', totals.total], ['Total Data', totals.all]] as const).map(([label, n]) => (
          <div className="col-md-4" key={label}><div className="card"><div className="card-body"><p className="text-muted text-uppercase small mb-1">{label}</p><h4 className="mb-0">{numberFormat(n)}</h4></div></div></div>
        ))}
      </div>
      <div className="card">
        <div className="card-header">
          <form method="get" className="row g-2 align-items-center filter-bar">
            <DataTableHidden state={table} defaults={TABLE} />
            <div className="col-md-3"><DateRangeInput name="wa_date" defaultValue={filter.date} placeholder="Date range" /></div>
            <div className="col-auto"><button type="submit" className="btn btn-secondary">Search</button></div>
            <div className="col-auto ms-auto">
              <a href={`${PATH}/export?${qs}`} className="btn btn-soft-info"><i className="ri-download-2-line" /> Export</a>
            </div>
          </form>
        </div>
        <div className="card-body">
          <DataTableControls path={PATH} query={queryString(params)} perPage={table.perPage} q={table.q} total={all.length} placeholder="Search campaign / template…" />
          {!rows.length ? <p className="text-muted mb-0">{filter.q ? 'No campaigns match this search.' : 'No campaigns for this period.'}</p> : (
            <div className="table-responsive">
              <table className="table table-sm align-middle table-nowrap table-striped table-report mb-0">
                <thead className="table-light">
                  <tr>
                    <th>#</th>
                    <SortTh {...th} column="date" first="desc">Date</SortTh>
                    <SortTh {...th} column="name">Campaign Name</SortTh>
                    <SortTh {...th} column="total" first="desc" className="num">Total</SortTh>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.id}>
                      <td>{offset + i + 1}</td>
                      <td>{phpDate('d-m-Y H:i', r.date)}</td>
                      <td>
                        <Link href={`/campaigns/${r.id}`}>{r.name}</Link>
                        {r.template && r.template !== r.name && <div className="small text-muted">{r.template}</div>}
                      </td>
                      <th className="num">{r.counts ? numberFormat(r.counts.total) : <span className="text-muted" title="Sent before messages were linked to campaigns">—</span>}</th>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="table-light">
                  <tr>
                    <th colSpan={3}>Total ({numberFormat(all.length)} campaign{all.length === 1 ? '' : 's'})</th>
                    <th className="num">{numberFormat(totals.total)}</th>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <Pagination path={PATH} params={params} page={table.page} perPage={table.perPage} total={all.length} always />
          <p className="small text-muted mt-2 mb-0">Total = Send + Delivered + Read. Failed, error and queued messages are only in Total Data; see <Link href={`/reports_templates?${qs}`}>Campaign Summary</Link> for the breakdown.</p>
        </div>
      </div>
    </>
  );
}
