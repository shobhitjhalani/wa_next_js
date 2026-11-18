import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { query, value } from '@/lib/db';
import { config } from '@/lib/config';
import { messageSummary } from '@/lib/format';
import { sp } from '@/lib/http';
import { phpDate } from '@/lib/time';
import type { MessageRow } from '@/lib/types';
import { PageTitle } from '@/components/PageTitle';
import { Pagination, pageParam } from '@/components/Pagination';
import { DateRangeInput, SelectAll } from '@/components/ui';
import { markIncoming } from './actions';
import { incomingFilter } from './filter';
import { IncomingRow } from './IncomingRow';

type Row = Pick<MessageRow, 'm_id' | 'm_created_on' | 'm_sender_name' | 'm_mobile_no' | 'm_is_read' | 'm_content' | 'm_msg_type' | 'm_msg_template_name' | 'm_msg_template_para'>;

/** Incoming messages / attachments list (IncomingController::listing + user/incoming.blade.php). */
export async function IncomingListing({ params, attachments }: { params: Record<string, string | string[] | undefined>; attachments: boolean }) {
  const user = await requireUser();
  const path = attachments ? '/incoming_attachment' : '/incoming';
  const title = attachments ? 'Attachments' : 'Incoming Msg';
  const { where, args, readStatus, mobile, content } = incomingFilter(user.u_id, params, attachments);
  const page = pageParam(params.page);
  const perPage = config.site.pageSize;
  // Export the same rows the filters show (all pages)
  const exportQs = new URLSearchParams({
    read_status: readStatus,
    ...(sp(params, 'wa_date') ? { wa_date: sp(params, 'wa_date') } : {}),
    ...(mobile ? { mobile_no: mobile } : {}),
    ...(content ? { content } : {}),
  }).toString();

  const [total, rows] = await Promise.all([
    value<number>(`SELECT COUNT(*)::int FROM js_message WHERE ${where}`, args),
    query<Row>(
      `SELECT m_id, m_created_on, m_sender_name, m_mobile_no, m_is_read, m_content, m_msg_type, m_msg_template_name, m_msg_template_para
         FROM js_message WHERE ${where} ORDER BY m_id DESC LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`,
      args,
    ),
  ]);
  const first = (page - 1) * perPage + 1;

  return (
    <>
      <PageTitle title={title} home="/dashboard" />
      <div className="card">
        <div className="card-header">
          <form method="get" className="row g-2 align-items-center filter-bar">
            <div className="col-md-3"><DateRangeInput name="wa_date" defaultValue={sp(params, 'wa_date')} placeholder="Date range" /></div>
            <div className="col-md-2"><input type="text" className="form-control" name="mobile_no" defaultValue={mobile} placeholder="Mobile No" aria-label="Mobile number" /></div>
            <div className="col-md-2"><input type="text" className="form-control" name="content" defaultValue={content} placeholder="Content" aria-label="Content" /></div>
            <div className="col-md-2">
              <select className="form-select" name="read_status" aria-label="Read status" defaultValue={readStatus}>
                <option value="-1">All</option>
                <option value="1">Read</option>
                <option value="2">Un-Read</option>
              </select>
            </div>
            <div className="col-auto"><button type="submit" className="btn btn-secondary">Search</button></div>
            <div className="col-auto ms-auto">
              <a href={`${path}/export?${exportQs}`} className="btn btn-soft-success" title="Download the messages these filters show as a CSV file">
                <i className="ri-file-excel-2-line" /> Export{total ? ` (${total.toLocaleString('en-US')})` : ''}
              </a>
            </div>
          </form>
        </div>
        <div className="card-body">
          <form action={markIncoming}>
            <div className="d-flex gap-2 mb-3">
              <select name="cstatus" className="form-select w-auto" required aria-label="Mark selected as" defaultValue="">
                <option value="">Mark selected as…</option>
                <option value="1">Read</option>
                <option value="2">Un-Read</option>
              </select>
              <button type="submit" className="btn btn-success">Change</button>
            </div>
            <div className="table-responsive">
              <table className="table align-middle table-nowrap table-striped mb-0">
                <thead className="table-light">
                  <tr>
                    <th><SelectAll target=".mids" /></th>
                    <th>#</th>
                    <th>Date</th>
                    <th>Sender Name</th>
                    <th>Mobile No</th>
                    <th>Content</th>
                    <th>Status</th>
                    {attachments && <th />}
                  </tr>
                </thead>
                <tbody>
                  {rows.length ? rows.map((m, i) => (
                    <IncomingRow key={m.m_id} id={Number(m.m_id)} read={Number(m.m_is_read) !== 2} attachment={attachments}>
                      <td>{first + i}</td>
                      <td>{phpDate('d M H:i:s', Number(m.m_created_on))}</td>
                      <td>{m.m_sender_name}</td>
                      <td><Link href={'/chat?mb=' + encodeURIComponent(m.m_mobile_no ?? '')}>{m.m_mobile_no}</Link></td>
                      <td className="msg-content">{messageSummary(m)}</td>
                    </IncomingRow>
                  )) : (
                    <tr><td colSpan={8} className="text-center text-muted py-4">No messages.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </form>
          <div className="mt-3"><Pagination path={path} params={params} page={page} perPage={perPage} total={total ?? 0} /></div>
        </div>
      </div>
    </>
  );
}
