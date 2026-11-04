import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { config } from '@/lib/config';
import { one, query, value } from '@/lib/db';
import { isErrorMessage, messageStatusLabel, messageSummary } from '@/lib/format';
import { limit, numberFormat } from '@/lib/text';
import { phpDate } from '@/lib/time';
import type { MessageRow } from '@/lib/types';
import { PageTitle } from '@/components/PageTitle';
import { Pagination, pageParam } from '@/components/Pagination';
import { ConfirmButton, DateRangeInput, SelectAll } from '@/components/ui';
import { bulkMessages } from '../actions';
import { dateInput, filled, input, intParam, MESSAGE_REPORTS, messageOrder, messageWhere, waUsers, type Params } from '../../_lib';
import { AutoSubmitSelect } from '../../_ui';

const COLS = `m_id, m_user_id, m_created_on, m_in_process_on, m_mobile_no, m_msg_type, m_content, m_msg_template_name,
  m_msg_template_para, m_sheet_id, m_updated_on, m_status, m_message_id, m_delivery_status, m_status_response`;

/** Admin message reports: send, que, error, failed, in_process (ReportController::messages). */
export default async function MessageReportPage({ params, searchParams }: { params: Promise<{ type: string }>; searchParams: Promise<Params> }) {
  await requireAdmin();
  const [{ type }, sp] = await Promise.all([params, searchParams]);
  const title = MESSAGE_REPORTS[type];
  if (!title) notFound();

  const page = pageParam(sp.page);
  const perPage = config.site.pageSize;
  const { where, statusWhere, args, ranged } = messageWhere(sp, type);
  const order = messageOrder(ranged);
  const n = args.length;

  const [messages, counts, users, templateNames] = await Promise.all([
    query<MessageRow & { u_username: string | null }>(
      `SELECT m.*, u.u_username
         FROM (SELECT ${COLS} FROM js_message WHERE ${where} AND ${statusWhere} ORDER BY ${order} LIMIT $${n + 1} OFFSET $${n + 2}) m
         LEFT JOIN js_user u ON u.u_id = m.m_user_id
        ORDER BY ${order}`,
      [...args, perPage, (page - 1) * perPage],
    ),
    type === 'send'
      ? one<{ total: number; pending: number; error: number; sent: number; tsent: number }>(
        `SELECT COUNT(*) FILTER (WHERE ${statusWhere})::int AS total,
                COUNT(*) FILTER (WHERE m_status = 1)::int AS pending,
                COUNT(*) FILTER (WHERE m_status = 3 AND m_message_id = '')::int AS error,
                COUNT(*) FILTER (WHERE m_status = 3 AND m_message_id <> '')::int AS sent,
                COUNT(*) FILTER (WHERE m_status = 3 AND m_message_id <> '' AND m_msg_type = 'template')::int AS tsent
           FROM js_message WHERE ${where}`, args)
      : value<number>(`SELECT COUNT(*)::int FROM js_message WHERE ${where} AND ${statusWhere}`, args).then((total) => ({ total: total ?? 0 })),
    waUsers(),
    filled(sp, 'user_id')
      ? query<{ ut_name: string }>('SELECT ut_name FROM js_user_templates WHERE ut_user_id = $1 AND ut_dstatus = 0 ORDER BY ut_name', [intParam(sp, 'user_id')])
      : Promise.resolve([]),
  ]);

  const total = counts?.total ?? 0;
  const stats = type === 'send' && counts && 'pending' in counts
    ? { Pending: counts.pending, Error: counts.error, Sent: counts.sent, 'Template Sent': counts.tsent }
    : null;
  const dtInput = dateInput(sp, ['send', 'error', 'failed'].includes(type));
  const bulk = ['que', 'error', 'failed', 'in_process'].includes(type);
  const userId = input(sp, 'user_id') ?? '';
  const template = input(sp, 'template') ?? '';

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) for (const item of Array.isArray(v) ? v : v === undefined ? [] : [v]) qs.append(k, item);
  const query_ = qs.toString();
  const path = `/wamaster/reports/messages/${type}`;

  return (
    <>
      <PageTitle title={title} home="/wamaster/dashboard" />
      {stats && (
        <div className="row">
          {Object.entries(stats).map(([label, num]) => (
            <div key={label} className="col-md-3"><div className="card"><div className="card-body"><p className="text-muted text-uppercase mb-1">{label}</p><h4 className="mb-0">{numberFormat(num)}</h4></div></div></div>
          ))}
        </div>
      )}
      <div className="card">
        <div className="card-header">
          <form method="get" className="row g-2 align-items-center filter-bar">
            <div className="col-md-2"><DateRangeInput name="wa_date" defaultValue={dtInput} placeholder="Date range" /></div>
            <div className="col-md-2">
              <AutoSubmitSelect className="form-select" name="user_id" defaultValue={userId} aria-label="User">
                <option value="">All users</option>
                {users.map((u) => <option key={u.u_id} value={String(u.u_id)}>{u.u_username}</option>)}
              </AutoSubmitSelect>
            </div>
            <div className="col-md-2">
              <select className="form-select" name="template" defaultValue={template} aria-label="Template">
                <option value="">All templates</option>
                <option value="-1">Non Template</option>
                {templateNames.map((t, i) => <option key={i} value={t.ut_name}>{t.ut_name}</option>)}
              </select>
            </div>
            <div className="col-md-2"><input type="text" className="form-control" name="mobile_no" defaultValue={input(sp, 'mobile_no') ?? ''} placeholder="Mobile No" aria-label="Mobile number" /></div>
            <div className="col-md-2"><input type="text" className="form-control" name="sheet_id" defaultValue={input(sp, 'sheet_id') ?? ''} placeholder="Sheet ID" aria-label="Sheet ID" /></div>
            {type === 'send' && (
              <>
                <div className="col-md-2">
                  <select className="form-select" name="dst" defaultValue={input(sp, 'dst') ?? ''} aria-label="Delivery status">
                    <option value="">All delivery</option>
                    {Object.entries(config.deliveryStatus).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div className="col-md-2">
                  <select className="form-select" name="msg_type" defaultValue={input(sp, 'msg_type') ?? ''} aria-label="Message type">
                    <option value="">All types</option>
                    <option value="1">Template</option>
                    <option value="2">Non-template</option>
                  </select>
                </div>
              </>
            )}
            <div className="col-auto"><button className="btn btn-secondary">Search</button></div>
            <div className="col-auto"><a className="btn btn-info" href={`${path}/export${query_ ? '?' + query_ : ''}`}><i className="ri-download-2-line" /> Export</a></div>
          </form>
        </div>
        <div className="card-body">
          {type !== 'send' && <p className="text-muted small">{numberFormat(total)} message(s)</p>}
          <form action={bulkMessages}>
            <input type="hidden" name="back" value={`${path}${query_ ? '?' + query_ : ''}`} />
            {bulk && (
              <div className="d-flex gap-2 mb-3">
                <select name="cstatus" className="form-select w-auto" required aria-label="Bulk action" defaultValue="">
                  <option value="">With selected…</option>
                  <option value="1">Delete</option>
                  {type !== 'que' && <option value="2">Resend (re-queue)</option>}
                </select>
                <ConfirmButton message="Apply to selected messages?" className="btn btn-success">Change</ConfirmButton>
              </div>
            )}
            <div className="table-responsive">
              <table className="table table-sm align-middle table-striped mb-0">
                <thead className="table-light">
                  <tr>
                    {bulk && <th><SelectAll target=".mids" /></th>}
                    <th>Username</th><th>Date</th><th>Mobile</th><th>Type</th><th>Content</th><th>Sheet</th><th>Updated</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.length ? messages.map((m) => (
                    <tr key={m.m_id}>
                      {bulk && <td><input type="checkbox" className="form-check-input mids" name="mids[]" value={m.m_id} aria-label="Select" /></td>}
                      <td>{m.u_username}</td>
                      <td className="text-nowrap">{phpDate('d M H:i:s', type === 'in_process' && m.m_in_process_on ? m.m_in_process_on : m.m_created_on)}</td>
                      <td>{m.m_mobile_no}</td>
                      <td>{m.m_msg_type}</td>
                      <td className="msg-content small">{limit(messageSummary(m), 120)}</td>
                      <td className="small">{m.m_sheet_id}</td>
                      <td className="text-nowrap small">{m.m_updated_on ? phpDate('d M H:i', m.m_updated_on) : ''}</td>
                      <td><span className={`badge ${isErrorMessage(m) || m.m_delivery_status === 'failed' ? 'bg-danger' : 'bg-info'} text-wrap text-start`}>{messageStatusLabel(m)}</span></td>
                    </tr>
                  )) : (
                    <tr><td colSpan={9} className="text-center text-muted py-4">No messages for this filter.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </form>
          <div className="mt-3"><Pagination path={path} params={sp} page={page} perPage={perPage} total={total} /></div>
        </div>
      </div>
    </>
  );
}
