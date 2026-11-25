import type { Metadata } from 'next';
import Link from 'next/link';
import { PageTitle } from '@/components/PageTitle';
import { Pagination, pageParam } from '@/components/Pagination';
import { DateRangeInput } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { query, value } from '@/lib/db';
import { numberFormat } from '@/lib/text';
import { phpDate } from '@/lib/time';
import { QrTabs } from '../QrTabs';
import { LOG_SELECT, logQuery, logStatus, logWhere, readLogFilter, type LogRow } from './filter';

export const metadata: Metadata = { title: 'Quick Replies Sent Log' };

const PER_PAGE = 50;

/** Every quick reply sent: date / time, mobile, name, the reply, what the customer wrote, the message status. */
export default async function QuickReplyLogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const params = await searchParams;
  const f = readLogFilter(params);
  const page = pageParam(params.page);
  const args: unknown[] = [];
  const where = logWhere(user.u_id, f, args);
  // Nothing is loaded until the filters are submitted (Search)
  const searched = params.s === '1' || !!(f.date || f.reply || f.q);
  const [rows, total, replies] = await Promise.all([
    searched ? query<LogRow>(`${LOG_SELECT} WHERE ${where} ORDER BY l.ql_sent_on DESC, l.ql_id DESC LIMIT ${PER_PAGE} OFFSET ${(page - 1) * PER_PAGE}`, args) : [],
    searched ? value<number>(`SELECT COUNT(*)::int FROM js_quick_reply_log l WHERE ${where}`, args) : 0,
    // Replies that were sent at least once (also deleted ones, by their last name), and every current one
    query<{ id: number; name: string }>(
      `SELECT id, name FROM (
         SELECT qr_id AS id, qr_name AS name FROM js_quick_reply WHERE qr_user_id = $1
         UNION
         SELECT DISTINCT ON (ql_qr_id) ql_qr_id, ql_qr_name || ' (deleted)' FROM js_quick_reply_log
          WHERE ql_user_id = $1 AND NOT EXISTS (SELECT 1 FROM js_quick_reply WHERE qr_id = ql_qr_id)
       ) x ORDER BY lower(name)`, [user.u_id]),
  ]);
  const filtered = !!(f.date || f.reply || f.q);

  return (
    <>
      <PageTitle title="Quick Replies" home="/dashboard" />
      <QrTabs tab="log" />
      <div className="card">
        <div className="card-header">
          <h5 className="card-title mb-0">Sent Log</h5>
          <p className="text-muted small mb-0">Every quick reply sent: when, to which mobile number and name, and what the customer wrote.</p>
        </div>
        <div className="card-body">
          <form method="get" className="row g-2 align-items-center mb-3">
            <input type="hidden" name="s" value="1" />
            <div className="col-md-3"><DateRangeInput name="date" defaultValue={f.date} placeholder="Date range" aria-label="Date range" /></div>
            <div className="col-md-3">
              <select name="reply" className="form-select" defaultValue={f.reply} aria-label="Quick reply">
                <option value="">All quick replies</option>
                {replies.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div className="col-md-3"><input type="search" name="q" className="form-control" defaultValue={f.q} placeholder="Mobile no or name" aria-label="Mobile number or name" /></div>
            <div className="col-md-3 d-flex gap-2">
              <button type="submit" className="btn btn-primary"><i className="ri-search-line" /> Search</button>
              {searched && <Link href="/quick_replies/log" className="btn btn-light">Clear</Link>}
              {searched && (
                <a href={`/quick_replies/log/export${logQuery(f)}`} className="btn btn-soft-success ms-auto" title="Download the filtered list as an Excel file">
                  <i className="ri-file-excel-2-line" /> Export
                </a>
              )}
            </div>
          </form>

          {!searched ? (
            <div className="text-center text-muted py-5 border rounded">
              <i className="ri-filter-3-line fs-2 d-block mb-1" />
              Choose a date range (and optionally a quick reply, mobile no or name), then click <b>Search</b> to see the replies sent.
            </div>
          ) : (<>
          <div className="small text-muted mb-2">{numberFormat(total ?? 0)} repl{total === 1 ? 'y' : 'ies'} sent{filtered ? ' (filtered)' : ''}</div>
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead className="table-light">
                <tr>
                  <th>Date / Time</th>
                  <th>Mobile No</th>
                  <th>Name</th>
                  <th>Quick Reply</th>
                  <th>Customer&apos;s Message</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.length ? rows.map((r) => (
                  <tr key={r.ql_id}>
                    <td className="text-nowrap small">{phpDate('d-m-Y h:i:s A', Number(r.ql_sent_on))}</td>
                    <td className="text-nowrap">{r.ql_mobile}</td>
                    <td>{r.ql_name || <span className="text-muted">—</span>}</td>
                    <td>
                      <Link href={`/quick_replies/log${logQuery({ ...f, reply: String(r.ql_qr_id) })}`} title="Only this quick reply">{r.ql_qr_name}</Link>
                      {r.ql_keyword && <div className="small text-muted">keyword “{r.ql_keyword}”</div>}
                    </td>
                    <td className="small text-truncate" style={{ maxWidth: 280 }} title={r.ql_text ?? ''}>{r.ql_text}</td>
                    <td className="small text-nowrap text-capitalize">{logStatus(r)}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={6} className="text-center text-muted py-5">{filtered ? 'No quick reply was sent for these filters.' : 'No quick reply has been sent yet.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination path="/quick_replies/log" params={params} page={page} perPage={PER_PAGE} total={total ?? 0} />
          </>)}
        </div>
      </div>
    </>
  );
}
