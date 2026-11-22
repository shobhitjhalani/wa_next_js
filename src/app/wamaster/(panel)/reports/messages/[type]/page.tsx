import { notFound } from 'next/navigation';
import { failureHelp, NO_REASON } from '@/lib/wa-errors';
import { FilterSelect } from '@/components/FilterSelect';
import { MESSAGE_REPORTS as MESSAGE_RIGHT, requireRight, visibleUserIds } from '@/lib/admin-access';
import { config } from '@/lib/config';
import { one, query, value } from '@/lib/db';
import { isErrorMessage, messageStatusLabel, messageSummary } from '@/lib/format';
import { limit, numberFormat } from '@/lib/text';
import { phpDate } from '@/lib/time';
import type { MessageRow } from '@/lib/types';
import { PageTitle } from '@/components/PageTitle';
import { DataTableControls, DataTableHidden, SortTh, queryString } from '@/components/DataTable';
import { Pagination } from '@/components/Pagination';
import { tableState } from '@/lib/datatable';
import { ConfirmButton, DateRangeInput, SelectAll } from '@/components/ui';
import { bulkMessages } from '../actions';
import { dateInput, filled, input, intParam, MESSAGE_REPORTS, MESSAGE_SORTS, messageTableOrder, messageWhere, waUsers, type MessageSort, type Params } from '../../_lib';

const COLS = `m_id, m_user_id, m_created_on, m_in_process_on, m_mobile_no, m_msg_type, m_content, m_msg_template_name,
  m_msg_template_para, m_sheet_id, m_updated_on, m_status, m_message_id, m_delivery_status, m_status_response`;

/** Admin message reports: send, que, error, failed, in_process (ReportController::messages). */
export default async function MessageReportPage({ params, searchParams }: { params: Promise<{ type: string }>; searchParams: Promise<Params> }) {
  const access = await requireRight(MESSAGE_RIGHT);
  const [{ type }, sp, ids] = await Promise.all([params, searchParams, visibleUserIds()]);
  const title = MESSAGE_REPORTS[type];
  if (!title) notFound();

  const tableDefaults = { sorts: Object.keys(MESSAGE_SORTS) as MessageSort[], sort: 'date' as MessageSort, dir: 'desc' as const, perPage: config.site.pageSize };
  const table = tableState(sp, tableDefaults);
  const { page, perPage } = table;
  const { where, statusWhere, args, ranged } = messageWhere(sp, type, ids);
  const order = messageTableOrder(ranged, table.sort, table.dir);
  const n = args.length;

  // Failed: the most common reasons for this filter (without the reason filter itself)
  const reasonFilter = type === 'failed' ? input(sp, 'reason') ?? '' : '';
  const reasonScope = type === 'failed' ? messageWhere({ ...sp, reason: undefined }, type, ids) : null;
  const [messages, counts, users, templateNames, reasons] = await Promise.all([
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
                COUNT(*) FILTER (WHERE m_status = 3 AND COALESCE(m_message_id, '') = '')::int AS error,
                COUNT(*) FILTER (WHERE m_status = 3 AND m_message_id <> '')::int AS sent,
                COUNT(*) FILTER (WHERE m_status = 3 AND m_message_id <> '' AND m_msg_type = 'template')::int AS tsent
           FROM js_message WHERE ${where}`, args)
      : value<number>(`SELECT COUNT(*)::int FROM js_message WHERE ${where} AND ${statusWhere}`, args).then((total) => ({ total: total ?? 0 })),
    waUsers(ids),
    filled(sp, 'user_id') && (!ids || ids.includes(intParam(sp, 'user_id')))
      ? query<{ ut_name: string }>('SELECT ut_name FROM js_user_templates WHERE ut_user_id = $1 AND ut_dstatus = 0 ORDER BY ut_name', [intParam(sp, 'user_id')])
      : Promise.resolve([]),
    reasonScope
      ? query<{ reason: string; n: number }>(
        `SELECT COALESCE(NULLIF(m_status_response, ''), '') AS reason, COUNT(*)::int AS n FROM js_message
          WHERE ${reasonScope.where} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`, reasonScope.args)
      : Promise.resolve([]),
  ]);
  const reasonTotal = reasons.reduce((a, r) => a + r.n, 0);
  const reasonHref = (r: string | null) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) for (const item of Array.isArray(v) ? v : v === undefined ? [] : [v]) if (k !== 'reason' && k !== 'page') q.append(k, item);
    if (r !== null) q.set('reason', r === '' ? '-' : r);
    return `/wamaster/reports/messages/failed?${q}`;
  };

  const total = counts?.total ?? 0;
  const stats = type === 'send' && counts && 'pending' in counts
    ? { Pending: counts.pending, Error: counts.error, Sent: counts.sent, 'Template Sent': counts.tsent }
    : null;
  const dtInput = dateInput(sp, ['send', 'error', 'failed'].includes(type));
  const bulk = ['que', 'error', 'failed', 'in_process'].includes(type) && access.can(MESSAGE_RIGHT, 'edit');
  const userId = input(sp, 'user_id') ?? '';
  const template = input(sp, 'template') ?? '';

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) for (const item of Array.isArray(v) ? v : v === undefined ? [] : [v]) qs.append(k, item);
  const query_ = qs.toString();
  const path = `/wamaster/reports/messages/${type}`;
  const th = { path, params: sp, state: table };

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
      {type === 'failed' && reasons.length > 0 && (
        <div className="card">
          <div className="card-header d-flex align-items-center">
            <h5 className="card-title mb-0 me-auto"><i className="ri-error-warning-line me-1 text-danger" />Why messages failed</h5>
            {reasonFilter && <a href={reasonHref(null)} className="btn btn-sm btn-light">Show all reasons</a>}
          </div>
          <div className="card-body p-0 table-responsive">
            <table className="table table-sm align-middle mb-0">
              <thead className="table-light"><tr><th>Reason (from WhatsApp)</th><th>What it means / what to do</th><th className="text-end">Messages</th><th className="text-end">Share</th></tr></thead>
              <tbody>
                {reasons.map((r) => {
                  const help = failureHelp(r.reason);
                  const active = reasonFilter === (r.reason || '-');
                  return (
                    <tr key={r.reason} className={active ? 'table-danger' : ''}>
                      <td style={{ minWidth: 220 }}>
                        <a href={reasonHref(r.reason)} className="fw-semibold text-danger">{r.reason || NO_REASON}</a>
                        {help && <div className="small text-muted">Error {help.code}</div>}
                      </td>
                      <td className="small">{help ? <>{help.meaning}<div className="text-success"><i className="ri-lightbulb-line" /> {help.action}</div></> : r.reason ? 'See the error in WhatsApp Manager.' : 'Failed before reasons were recorded.'}</td>
                      <td className="text-end">{numberFormat(r.n)}</td>
                      <td className="text-end text-muted small">{!reasonTotal ? '0%' : r.n / reasonTotal < 0.001 ? '<0.1%' : `${Math.round((r.n / reasonTotal) * 1000) / 10}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="card">
        <div className="card-header">
          <form method="get" className="row g-2 align-items-center filter-bar">
            <DataTableHidden state={table} defaults={tableDefaults} />
            {reasonFilter && <input type="hidden" name="reason" value={reasonFilter} />}
            <div className="col-md-2"><DateRangeInput name="wa_date" defaultValue={dtInput} placeholder="Date range" /></div>
            <div className="col-md-2">
              <FilterSelect name="user_id" defaultValue={userId} autoSubmit placeholder="All users" searchPlaceholder="Search user…"
                options={[{ value: '', label: 'All users' }, ...users.map((u) => ({ value: String(u.u_id), label: u.u_username || `#${u.u_id}` }))]} />
            </div>
            <div className="col-md-2">
              <FilterSelect name="template" defaultValue={template} placeholder="All templates" searchPlaceholder="Search template…"
                options={[{ value: '', label: 'All templates' }, { value: '-1', label: 'Non Template' },
                  ...[...new Set(templateNames.map((t) => t.ut_name).filter(Boolean))].map((n) => ({ value: n, label: n }))]} />
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
          <DataTableControls path={path} query={query_} perPage={perPage} q={table.q} total={total} placeholder="Search mobile, template, text…" />
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
                    <th>Username</th>
                    <SortTh {...th} column="date" first="desc">Date</SortTh>
                    <SortTh {...th} column="mobile">Mobile</SortTh>
                    <SortTh {...th} column="type">Type</SortTh>
                    <th>Content</th><th>Sheet</th>
                    <SortTh {...th} column="updated" first="desc">Updated</SortTh>
                    <SortTh {...th} column="status">{type === 'failed' ? 'Reason' : 'Status'}</SortTh>
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
                      <td style={type === 'failed' ? { minWidth: 220 } : undefined}>
                        {type === 'failed' ? (() => {
                          const help = failureHelp(m.m_status_response);
                          return <><span className="badge bg-danger text-wrap text-start">{m.m_status_response || 'Failed'}</span>
                            {help && <div className="small text-muted mt-1" title={help.action}>{help.meaning}</div>}</>;
                        })() : <span className={`badge ${isErrorMessage(m) || m.m_delivery_status === 'failed' ? 'bg-danger' : 'bg-info'} text-wrap text-start`}>{messageStatusLabel(m)}</span>}
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan={9} className="text-center text-muted py-4">No messages for this filter.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </form>
          <div className="mt-3"><Pagination path={path} params={sp} page={page} perPage={perPage} total={total} always /></div>
        </div>
      </div>
    </>
  );
}
