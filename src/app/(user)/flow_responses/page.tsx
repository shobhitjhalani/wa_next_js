import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment } from 'react';
import { requireUser } from '@/lib/auth';
import { config } from '@/lib/config';
import { query, value } from '@/lib/db';
import { flowAnswers } from '@/lib/flow-response';
import { sp } from '@/lib/http';
import { numberFormat } from '@/lib/text';
import { phpDate } from '@/lib/time';
import { PageTitle } from '@/components/PageTitle';
import { Pagination, pageParam } from '@/components/Pagination';
import { DateRangeInput, SelectAll } from '@/components/ui';
import { markAllFlowResponsesRead, markFlowResponses, readFlowResponse } from './actions';
import { filterWhere, readFilter } from './filter';

export const metadata: Metadata = { title: 'Flow Responses' };

type Params = Promise<Record<string, string | string[] | undefined>>;

interface Row {
  fr_id: number;
  fr_mobile_no: string | null;
  fr_sender_name: string | null;
  fr_template_name: string | null;
  fr_response: unknown;
  fr_is_read: number;
  fr_created_on: number;
}

/** Answers customers submitted through WhatsApp Flows (forms opened from flow templates). */
export default async function FlowResponsesPage({ searchParams }: { searchParams: Params }) {
  const user = await requireUser();
  const params = await searchParams;
  const filter = readFilter(params);
  const page = pageParam(params.page);
  const perPage = config.site.pageSize;

  const args: unknown[] = [];
  const where = filterWhere(user.u_id, filter, args);
  const [total, unread, rows, templates] = await Promise.all([
    value<number>(`SELECT COUNT(*)::int FROM js_flow_responses WHERE ${where}`, args),
    value<number>('SELECT COUNT(*)::int FROM js_flow_responses WHERE fr_user_id = $1 AND fr_is_read = 2', [user.u_id]),
    query<Row>(
      `SELECT fr_id, fr_mobile_no, fr_sender_name, fr_template_name, fr_response, fr_is_read, fr_created_on
         FROM js_flow_responses WHERE ${where} ORDER BY fr_id DESC LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`,
      args,
    ),
    query<{ name: string | null }>(
      'SELECT DISTINCT fr_template_name AS name FROM js_flow_responses WHERE fr_user_id = $1 ORDER BY 1 NULLS LAST', [user.u_id]),
  ]);
  const first = (page - 1) * perPage + 1;
  const exportQs = new URLSearchParams();
  for (const k of ['fr_date', 'mobile_no', 'template', 'read_status']) if (sp(params, k)) exportQs.set(k, sp(params, k));

  return (
    <>
      <PageTitle title="Flow Responses" home="/dashboard" />
      <div className="card">
        <div className="card-header">
          <form method="get" className="row g-2 align-items-center filter-bar">
            <div className="col-md-3"><DateRangeInput name="fr_date" defaultValue={filter.date} placeholder="Date range" /></div>
            <div className="col-md-2"><input type="text" className="form-control" name="mobile_no" defaultValue={filter.mobile} placeholder="Mobile No" aria-label="Mobile number" /></div>
            <div className="col-md-3">
              <select className="form-select" name="template" aria-label="Template" defaultValue={filter.template}>
                <option value="">All templates</option>
                {templates.map((t) => <option key={t.name ?? '-'} value={t.name ?? '-'}>{t.name ?? '(template not known)'}</option>)}
              </select>
            </div>
            <div className="col-md-2">
              <select className="form-select" name="read_status" aria-label="Read status" defaultValue={filter.read}>
                <option value="">All</option>
                <option value="2">Un-Read</option>
                <option value="1">Read</option>
              </select>
            </div>
            <div className="col-auto"><button type="submit" className="btn btn-secondary">Search</button></div>
            <div className="col-auto ms-auto">
              <a href={`/flow_responses/export${exportQs.size ? '?' + exportQs.toString() : ''}`} className="btn btn-soft-info"><i className="ri-download-2-line" /> Export</a>
            </div>
          </form>
        </div>
        <div className="card-body">
          <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
            <form action={markFlowResponses} id="flow_mark" className="d-flex gap-2">
              <select name="cstatus" className="form-select w-auto" required aria-label="Mark selected as" defaultValue="">
                <option value="">Mark selected as…</option>
                <option value="1">Read</option>
                <option value="2">Un-Read</option>
              </select>
              <button type="submit" className="btn btn-success">Change</button>
            </form>
            {(unread ?? 0) > 0 && (
              <form action={markAllFlowResponsesRead}>
                <button type="submit" className="btn btn-soft-secondary">Mark all {numberFormat(unread ?? 0)} unread as read</button>
              </form>
            )}
            <span className="ms-auto text-muted small">{numberFormat(total ?? 0)} response(s)</span>
          </div>
          <div className="table-responsive">
            <table className="table align-middle table-striped mb-0">
              <thead className="table-light">
                <tr>
                  <th style={{ width: 32 }}><SelectAll target=".frids" /></th>
                  <th>#</th>
                  <th className="text-nowrap">Date</th>
                  <th>Customer</th>
                  <th>Template</th>
                  <th>Answers</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.length ? rows.map((r, i) => {
                  const isNew = Number(r.fr_is_read) === 2;
                  const answers = flowAnswers(r.fr_response);
                  return (
                    <tr key={r.fr_id} className={isNew ? 'fw-semibold' : ''}>
                      <td><input type="checkbox" className="form-check-input frids" name="ids" value={r.fr_id} form="flow_mark" aria-label="Select" /></td>
                      <td>{first + i}</td>
                      <td className="text-nowrap">
                        {r.fr_created_on ? phpDate('d M Y H:i', Number(r.fr_created_on)) : '—'}
                        {isNew && <span className="badge bg-success-subtle text-success ms-1">New</span>}
                      </td>
                      <td className="text-nowrap">
                        {r.fr_sender_name && <div>{r.fr_sender_name}</div>}
                        <Link href={'/chat?mb=' + encodeURIComponent(r.fr_mobile_no ?? '')}>{r.fr_mobile_no}</Link>
                      </td>
                      <td>{r.fr_template_name ?? <span className="text-muted">—</span>}</td>
                      <td style={{ minWidth: 260 }}>
                        {answers.length ? (
                          <dl className="row mb-0 small">
                            {answers.map((a) => (
                              <Fragment key={a.key}>
                                <dt className="col-sm-5 text-muted fw-normal">{a.label}</dt>
                                <dd className="col-sm-7 mb-1 text-break" style={{ whiteSpace: 'pre-line' }}>{a.value || <span className="text-muted">—</span>}</dd>
                              </Fragment>
                            ))}
                          </dl>
                        ) : <span className="text-muted">No answers</span>}
                      </td>
                      <td className="text-end">
                        {isNew && (
                          <form action={readFlowResponse.bind(null, r.fr_id)}>
                            <button type="submit" className="btn btn-sm btn-soft-primary text-nowrap" title="Mark as read"><i className="ri-check-line" /> Read</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                }) : (
                  <tr><td colSpan={7} className="text-center text-muted py-4">No flow responses yet. Replies to templates with a Flow button appear here.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3"><Pagination path="/flow_responses" params={params} page={page} perPage={perPage} total={total ?? 0} /></div>
        </div>
      </div>
    </>
  );
}
