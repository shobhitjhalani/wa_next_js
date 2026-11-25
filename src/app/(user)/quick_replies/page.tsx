import type { Metadata } from 'next';
import Link from 'next/link';
import { DataTableControls, SortTh, queryString } from '@/components/DataTable';
import { PageTitle } from '@/components/PageTitle';
import { Pagination } from '@/components/Pagination';
import { ConfirmButton } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { like, query, value } from '@/lib/db';
import { sqlDir, tableHref, tableState } from '@/lib/datatable';
import { matchLabel, typeInfo, type QrData } from '@/lib/quick-reply';
import { numberFormat } from '@/lib/text';
import { phpDate } from '@/lib/time';
import { deleteQuickReply, duplicateQuickReply, setQuickReplyStatus } from './actions';
import { QrTabs } from './QrTabs';
import { TryMessage } from './TryMessage';

export const metadata: Metadata = { title: 'Quick Replies' };

const PATH = '/quick_replies';

const SORTS = {
  name: 'lower(qr_name)',
  sent: 'qr_hits',
  used: 'qr_last_used',
  updated: 'qr_updated_on',
} as const;

interface Row {
  qr_id: number; qr_name: string; qr_keywords: string[]; qr_match: number; qr_type: string; qr_data: QrData;
  qr_status: number; qr_hits: number; qr_last_used: number; qr_updated_on: number;
}

/** Quick Replies: automatic answers (message, media, buttons, list) to keywords. */
export default async function QuickRepliesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const params = await searchParams;
  const table = tableState(params, { sorts: Object.keys(SORTS) as (keyof typeof SORTS)[], sort: 'updated', dir: 'desc' });
  const where = `qr_user_id = $1 AND ($2 = '' OR qr_name ILIKE $2 OR EXISTS (SELECT 1 FROM unnest(qr_keywords) k WHERE k ILIKE $2))`;
  const args = [user.u_id, table.q ? `%${like(table.q)}%` : ''];
  const [rows, total, all] = await Promise.all([
    query<Row>(
      `SELECT qr_id, qr_name, qr_keywords, qr_match, qr_type, qr_data, qr_status, qr_hits, qr_last_used, qr_updated_on
         FROM js_quick_reply WHERE ${where}
        ORDER BY ${SORTS[table.sort]} ${sqlDir(table.dir)}, qr_id ${sqlDir(table.dir)}
        LIMIT ${table.perPage} OFFSET ${(table.page - 1) * table.perPage}`, args),
    value<number>(`SELECT COUNT(*)::int FROM js_quick_reply WHERE ${where}`, args),
    value<number>('SELECT COUNT(*)::int FROM js_quick_reply WHERE qr_user_id = $1', [user.u_id]),
  ]);
  const th = { path: PATH, params, state: table };
  const back = tableHref(PATH, params, {});

  return (
    <>
      <PageTitle title="Quick Replies" home="/dashboard" />
      <QrTabs tab="replies" />
      <div className="card">
        <div className="card-header d-flex align-items-center flex-wrap gap-2">
          <div className="me-auto">
            <h5 className="card-title mb-0">Quick Replies</h5>
            <p className="text-muted small mb-0">
              Answer a keyword automatically with a message, media, buttons or a list. A customer&apos;s message can match a keyword exactly,
              contain it, start or end with it.
            </p>
          </div>
          <Link href="/quick_replies/new" className="btn btn-success"><i className="ri-add-line" /> New Quick Reply</Link>
        </div>
        <div className="card-body">
          {(all ?? 0) > 0 && <TryMessage />}
          <DataTableControls path={PATH} query={queryString(params)} perPage={table.perPage} q={table.q} total={total ?? 0} placeholder="Search name or keyword…" />
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead className="table-light">
                <tr>
                  <SortTh {...th} column="name">Quick reply</SortTh>
                  <th>Keywords</th>
                  <th>Reply</th>
                  <SortTh {...th} column="sent" first="desc" className="text-end">Sent</SortTh>
                  <SortTh {...th} column="used" first="desc">Last sent</SortTh>
                  <th>Status</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length ? rows.map((r) => {
                  const info = typeInfo(r.qr_type);
                  const on = Number(r.qr_status) === 1;
                  const extra = r.qr_type === 'buttons' ? `${r.qr_data.buttons?.length ?? 0} button(s)${r.qr_data.media ? ' + media' : ''}`
                    : r.qr_type === 'list' ? `${r.qr_data.rows?.length ?? 0} item(s)` : '';
                  return (
                    <tr key={r.qr_id} className={on ? undefined : 'opacity-75'}>
                      <td style={{ minWidth: 180 }}>
                        <Link href={`/quick_replies/${r.qr_id}`} className="fw-medium">{r.qr_name}</Link>
                        <div className="small text-muted text-truncate" style={{ maxWidth: 260 }}>{r.qr_data.text || (r.qr_type === 'media' ? 'Media without caption' : '')}</div>
                      </td>
                      <td style={{ maxWidth: 300 }}>
                        <div className="d-flex flex-wrap gap-1">
                          {r.qr_keywords.slice(0, 8).map((k) => <span key={k} className="badge bg-light text-body border fw-normal">{k}</span>)}
                          {r.qr_keywords.length > 8 && <span className="small text-muted">+{r.qr_keywords.length - 8} more</span>}
                        </div>
                        <div className="small text-muted mt-1">Message {matchLabel(r.qr_match).toLowerCase()} a keyword</div>
                      </td>
                      <td className="text-nowrap">
                        <i className={`${info.icon} me-1 text-primary`} />{info.label}
                        {extra && <div className="small text-muted">{extra}</div>}
                      </td>
                      <td className="text-end">{r.qr_hits ? <Link href={`/quick_replies/log?reply=${r.qr_id}`} title="Sent log of this reply">{numberFormat(r.qr_hits)}</Link> : 0}</td>
                      <td className="small text-nowrap">{r.qr_last_used ? phpDate('d M Y, h:i A', r.qr_last_used) : '—'}</td>
                      <td>
                        <form action={setQuickReplyStatus.bind(null, r.qr_id, !on, back)}>
                          <button type="submit" className={`badge border-0 ${on ? 'bg-success-subtle text-success' : 'bg-secondary-subtle text-secondary'}`}
                            title={on ? 'Click to switch off' : 'Click to switch on'}>
                            <i className={`${on ? 'ri-toggle-fill' : 'ri-toggle-line'} me-1`} />{on ? 'On' : 'Off'}
                          </button>
                        </form>
                      </td>
                      <td className="text-end text-nowrap">
                        <div className="d-inline-flex gap-1">
                          <Link href={`/quick_replies/${r.qr_id}`} className="btn btn-sm btn-soft-primary" title="Edit" aria-label="Edit"><i className="ri-pencil-line" /></Link>
                          <form action={duplicateQuickReply.bind(null, r.qr_id)}>
                            <button type="submit" className="btn btn-sm btn-soft-secondary" title="Duplicate" aria-label="Duplicate"><i className="ri-file-copy-line" /></button>
                          </form>
                          <form action={deleteQuickReply.bind(null, r.qr_id, back)}>
                            <ConfirmButton message={`Delete the quick reply “${r.qr_name}”?`} className="btn btn-sm btn-soft-danger" title="Delete" aria-label="Delete">
                              <i className="ri-delete-bin-line" />
                            </ConfirmButton>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={7} className="text-center text-muted py-5">
                      {table.q ? 'No quick replies match this search.' : (
                        <>
                          No quick replies yet. Create one to answer a keyword (e.g. “price”, “location”, “hi”) automatically.
                          <div className="mt-3"><Link href="/quick_replies/new" className="btn btn-success btn-sm"><i className="ri-add-line" /> Create your first quick reply</Link></div>
                        </>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination path={PATH} params={params} page={table.page} perPage={table.perPage} total={total ?? 0} always />
          <p className="small text-muted mt-3 mb-0">
            <i className="ri-information-line me-1" />An active Chatbot Flow answers its keywords first. When several quick replies match, “Is exactly” wins,
            then “Starts with”, “Ends with” and “Contains”; then the longest keyword. A tapped button or list item is matched by its title too, so it can
            open the next quick reply.
          </p>
        </div>
      </div>
    </>
  );
}
