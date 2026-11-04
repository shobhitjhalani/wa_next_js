import { PageTitle } from '@/components/PageTitle';
import { Pagination, pageParam } from '@/components/Pagination';
import { ConfirmButton, DateRangeInput } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { config } from '@/lib/config';
import { isErrorMessage, messageStatusLabel, messageSummary } from '@/lib/format';
import { sp } from '@/lib/http';
import { limit, numberFormat } from '@/lib/text';
import { phpDate } from '@/lib/time';
import { cancelQueue, resendMessage } from './actions';
import { dateInput, PAGE_SIZE, reportPage, templateNames, type ReportType } from './query';

type SearchParams = Record<string, string | string[] | undefined>;

const PATHS: Record<ReportType, string> = { queue: '/que', all: '/reports', failed: '/reports_failed', error: '/reports_error' };

const basename = (file: string) => file.replace(/\/+$/, '').split('/').pop() ?? file;

/** Message report table (resources/views/user/reports/messages.blade.php). */
export async function MessagesReport({ type, title, searchParams }: { type: ReportType; title: string; searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const params = await searchParams;
  const page = pageParam(params.page);
  const [{ total, rows }, names] = await Promise.all([
    reportPage(user.u_id, type, params, page),
    type === 'queue' ? Promise.resolve([] as string[]) : templateNames(user.u_id),
  ]);
  const exportQs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) for (const item of Array.isArray(v) ? v : v === undefined ? [] : [v]) exportQs.append(k, item);
  const exportHref = `/reports/export/${type}${exportQs.size ? '?' + exportQs.toString() : ''}`;
  const firstItem = (page - 1) * PAGE_SIZE + 1;

  return (
    <>
      <PageTitle title={title} home="/dashboard" />
      <div className="card">
        <div className="card-header">
          <form method="get" className="row g-2 align-items-center filter-bar">
            <div className="col-md-3"><DateRangeInput name="wa_date" defaultValue={dateInput(params)} placeholder="Date range" /></div>
            <div className="col-md-2"><input type="text" className="form-control" name="mobile_no" defaultValue={sp(params, 'mobile_no')} placeholder="Mobile No" aria-label="Mobile number" /></div>
            {type !== 'queue' && (
              <div className="col-md-2">
                <select className="form-select" name="template" aria-label="Template" defaultValue={sp(params, 'template')}>
                  <option value="">All templates</option>
                  {names.map((name, i) => <option key={i} value={name}>{name}</option>)}
                </select>
              </div>
            )}
            {type === 'all' && (
              <>
                <div className="col-md-2">
                  <select className="form-select" name="msg_type" aria-label="Message type" defaultValue={sp(params, 'msg_type')}>
                    <option value="">All types</option>
                    <option value="1">Template</option>
                    <option value="2">Replies</option>
                  </select>
                </div>
                <div className="col-md-2">
                  <select className="form-select" name="del_status" aria-label="Delivery status" defaultValue={sp(params, 'del_status')}>
                    <option value="">All statuses</option>
                    {Object.entries(config.deliveryStatus).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </>
            )}
            <div className="col-auto"><button type="submit" className="btn btn-secondary">Search</button></div>
            {type !== 'queue' && (
              <div className="col-auto"><a href={exportHref} className="btn btn-info"><i className="ri-download-2-line" /> Export</a></div>
            )}
          </form>
          {type === 'queue' && (
            <form action={cancelQueue} className="mt-2">
              <ConfirmButton message="Cancel ALL queued messages?" className="btn btn-danger btn-sm">Cancel All</ConfirmButton>
            </form>
          )}
        </div>
        <div className="card-body">
          <p className="text-muted small">{numberFormat(total)} message(s)</p>
          <div className="table-responsive">
            <table className="table align-middle table-nowrap table-striped mb-0">
              <thead className="table-light">
                <tr>
                  <th>#</th>
                  <th>Date</th>
                  <th>Mobile No</th>
                  <th>Content</th>
                  <th>Updated On</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.length ? rows.map((m, i) => {
                  const isError = isErrorMessage(m);
                  const failed = m.m_delivery_status === 'failed';
                  const files = String((type === 'queue' ? m.m_image : m.m_response_file_name) ?? '').split(',').filter((f) => f !== '' && f !== '0');
                  return (
                    <tr key={m.m_id}>
                      <td>{firstItem + i}</td>
                      <td>{phpDate('d M H:i:s', m.m_created_on)}</td>
                      <td>{m.m_mobile_no}</td>
                      <td className="msg-content">
                        {limit(messageSummary(m), 100)}
                        {files.map((file, j) => (
                          <span key={j}><br /><a href={file} target="_blank" rel="noopener" className="small">{basename(file)}</a></span>
                        ))}
                      </td>
                      <td>{m.m_updated_on ? phpDate('d-M-Y H:i:s', m.m_updated_on) : ''}</td>
                      <td>
                        <span className={`badge ${isError || failed ? 'bg-danger' : 'bg-info'} text-wrap text-start`}>{messageStatusLabel(m)}</span>
                      </td>
                      <td>
                        {([1, 6].includes(Number(m.m_status)) || isError || failed) && (
                          <form action={resendMessage.bind(null, m.m_id)}>
                            <ConfirmButton message="Send this message now?" className="btn btn-sm btn-soft-danger" title="Send now" aria-label="Send now">
                              <i className="ri-send-plane-2-fill" />
                            </ConfirmButton>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                }) : (
                  <tr><td colSpan={7} className="text-center text-muted py-4">No messages for this filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination path={PATHS[type]} params={params} page={page} perPage={PAGE_SIZE} total={total} />
        </div>
      </div>
    </>
  );
}
