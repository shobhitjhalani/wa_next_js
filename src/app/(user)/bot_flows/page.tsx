import './flows.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DataTableControls, SortTh, queryString } from '@/components/DataTable';
import { PageTitle } from '@/components/PageTitle';
import { Pagination } from '@/components/Pagination';
import { ConfirmButton } from '@/components/ui';
import { requireBotUser } from '@/lib/auth';
import { FLOW_TABS } from '@/lib/bot-flow';
import { like, query, value } from '@/lib/db';
import { sqlDir, tableHref, tableState } from '@/lib/datatable';
import { sp } from '@/lib/http';
import { numberFormat } from '@/lib/text';
import { phpDate } from '@/lib/time';
import { CopyFlowButton, PasteFlowButton } from './FlowCode';
import { activateFlow, createFlow, deleteFlow, duplicateFlow, pauseFlow } from './actions';

export const metadata: Metadata = { title: 'Chatbot Flows' };

const PATH = '/bot_flows';

/** Sortable columns → SQL (whitelist; bf_id breaks ties so paging is stable). */
const SORTS = {
  name: 'lower(f.bf_name)',
  conversations: 'COALESCE(s.total, 0)',
  running: 'COALESCE(s.running, 0)',
  updated: 'f.bf_updated_on',
  created: 'f.bf_created_on',
} as const;

interface Row {
  bf_id: number; bf_name: string; bf_keywords: string[]; bf_match: number; bf_status: number; bf_updated_on: number; bf_created_on: number;
  steps: number; running: number; completed: number; total: number;
}

/** Chatbot flows: keyword-triggered conversations built in the Flow Builder; tabs by status, server-side table. */
export default async function BotFlowsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireBotUser();
  const params = await searchParams;

  const counts = new Map((await query<{ bf_status: number; n: number }>(
    'SELECT bf_status, COUNT(*)::int AS n FROM js_bot_flow WHERE bf_user_id = $1 GROUP BY bf_status', [user.u_id])).map((r) => [Number(r.bf_status), r.n]));
  // Without ?tab=, open the first tab that has flows (Active when there are none at all)
  const asked = FLOW_TABS.find((t) => t.key === sp(params, 'tab'));
  const tab = asked ?? FLOW_TABS.find((t) => counts.get(t.status)) ?? FLOW_TABS[0];
  const tableParams = { ...params, tab: tab.key };
  const table = tableState(tableParams, { sorts: Object.keys(SORTS) as (keyof typeof SORTS)[], sort: 'updated', dir: 'desc' });

  const where = `f.bf_user_id = $1 AND f.bf_status = $2
    AND ($3 = '' OR f.bf_name ILIKE $3 OR EXISTS (SELECT 1 FROM unnest(f.bf_keywords) k WHERE k ILIKE $3))`;
  const search = table.q ? `%${like(table.q)}%` : '';
  const args = [user.u_id, tab.status, search];
  const [rows, total] = await Promise.all([
    query<Row>(
      `SELECT f.bf_id, f.bf_name, f.bf_keywords, f.bf_match, f.bf_status, f.bf_updated_on, f.bf_created_on,
              GREATEST(jsonb_array_length(COALESCE(f.bf_graph->'nodes', '[]'::jsonb)) - 1, 0)::int AS steps,
              COALESCE(s.running, 0)::int AS running, COALESCE(s.completed, 0)::int AS completed, COALESCE(s.total, 0)::int AS total
         FROM js_bot_flow f
         LEFT JOIN LATERAL (
           SELECT COUNT(*) FILTER (WHERE bs_status = 1) AS running, COUNT(*) FILTER (WHERE bs_status = 2) AS completed, COUNT(*) AS total
             FROM js_bot_session WHERE bs_flow_id = f.bf_id) s ON true
        WHERE ${where}
        ORDER BY ${SORTS[table.sort]} ${sqlDir(table.dir)}, f.bf_id ${sqlDir(table.dir)}
        LIMIT ${table.perPage} OFFSET ${(table.page - 1) * table.perPage}`, args),
    value<number>(`SELECT COUNT(*)::int FROM js_bot_flow f WHERE ${where}`, args),
  ]);

  const th = { path: PATH, params: tableParams, state: table };
  const back = tableHref(PATH, tableParams, {});
  const empty = {
    active: 'No active flows. Activate a draft or paused flow to start answering keywords.',
    paused: 'No paused flows. Pausing an active flow stops it answering until you resume it.',
    draft: 'No drafts. New flows start here until you activate them.',
  }[tab.key];

  return (
    <>
      <PageTitle title="Chatbot Flows" home="/dashboard" />
      <div className="card">
        <div className="card-header d-flex align-items-center flex-wrap gap-2">
          <div className="me-auto">
            <h5 className="card-title mb-0">Chatbot Flows</h5>
            <p className="text-muted small mb-0">Automatic WhatsApp conversations that start when a customer sends a keyword.</p>
          </div>
          <PasteFlowButton />
          <form action={createFlow}>
            <button type="submit" className="btn btn-success"><i className="ri-add-line" /> New Flow</button>
          </form>
        </div>
        <nav className="bf-tabs" aria-label="Flow status">
          {FLOW_TABS.map((t) => (
            <Link key={t.key} href={tableHref(PATH, {}, { tab: t.key })} scroll={false}
              className={`bf-tab${t.key === tab.key ? ' active' : ''}`} aria-current={t.key === tab.key ? 'page' : undefined}>
              <span className={`bf-dot ${t.badge}`} />{t.label}
              <span className="bf-count">{numberFormat(counts.get(t.status) ?? 0)}</span>
            </Link>
          ))}
        </nav>
        <div className="card-body">
          <DataTableControls path={PATH} query={queryString(tableParams)} perPage={table.perPage} q={table.q} total={total ?? 0} placeholder="Search name or keyword…" />
          <div className="table-responsive">
            <table className="table table-hover align-middle table-nowrap mb-0 bf-table">
              <thead className="table-light">
                <tr>
                  <SortTh {...th} column="name">Flow</SortTh>
                  <th>Trigger keywords</th>
                  <SortTh {...th} column="conversations" first="desc" className="text-end">Conversations</SortTh>
                  <SortTh {...th} column="running" first="desc" className="text-end">Running</SortTh>
                  <SortTh {...th} column="updated" first="desc">Updated</SortTh>
                  <SortTh {...th} column="created" first="desc">Created</SortTh>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length ? rows.map((f) => (
                  <tr key={f.bf_id}>
                    <td>
                      <Link href={`/bot_flows/${f.bf_id}`} className="bf-name">{f.bf_name}</Link>
                      <div className="small text-muted">{f.steps} step{f.steps === 1 ? '' : 's'}</div>
                    </td>
                    <td className="text-wrap" style={{ maxWidth: 320 }}>
                      {f.bf_keywords.length
                        ? f.bf_keywords.slice(0, 8).map((k) => <span key={k} className="bf-keyword">{k}</span>)
                        : <span className="text-muted small fst-italic">No keywords yet</span>}
                      {f.bf_keywords.length > 8 && <span className="small text-muted">+{f.bf_keywords.length - 8} more</span>}
                      {f.bf_keywords.length > 0 && <div className="small text-muted">{Number(f.bf_match) === 2 ? 'Message contains a keyword' : 'Message equals a keyword'}</div>}
                    </td>
                    <td className="text-end">
                      <Link href={`/bot_flows/${f.bf_id}/sessions`} className="fw-semibold text-body">{numberFormat(f.total)}</Link>
                      <div className="small text-muted">{numberFormat(f.completed)} completed</div>
                    </td>
                    <td className="text-end">{f.running ? <span className="badge bg-info-subtle text-info">{numberFormat(f.running)}</span> : <span className="text-muted">0</span>}</td>
                    <td className="small">{f.bf_updated_on ? phpDate('d M Y, h:i A', f.bf_updated_on) : '—'}</td>
                    <td className="small">{f.bf_created_on ? phpDate('d M Y', f.bf_created_on) : '—'}</td>
                    <td className="text-end">
                      <div className="bf-actions">
                        {tab.key === 'active' ? (
                          <form action={pauseFlow.bind(null, f.bf_id, back)}>
                            <ConfirmButton message={`Pause “${f.bf_name}”? It stops answering keywords${f.running ? ` and ${f.running} running conversation(s) stop` : ''}.`} className="btn btn-sm btn-outline-warning bf-main">
                              <i className="ri-pause-line align-bottom me-1" />Pause
                            </ConfirmButton>
                          </form>
                        ) : (
                          <form action={activateFlow.bind(null, f.bf_id, back)}>
                            <button type="submit" className="btn btn-sm btn-outline-success bf-main">
                              <i className="ri-play-line align-bottom me-1" />{tab.key === 'paused' ? 'Resume' : 'Activate'}
                            </button>
                          </form>
                        )}
                        <div className="bf-icons">
                          <Link href={`/bot_flows/${f.bf_id}`} title="Edit in Flow Builder" aria-label="Edit"><i className="ri-pencil-line" /></Link>
                          <Link href={`/bot_flows/${f.bf_id}/sessions`} title="Conversations and saved answers" aria-label="Conversations"><i className="ri-chat-history-line" /></Link>
                          <CopyFlowButton id={f.bf_id} />
                          <form action={duplicateFlow.bind(null, f.bf_id)}>
                            <button type="submit" title="Duplicate as a draft" aria-label="Duplicate"><i className="ri-file-copy-line" /></button>
                          </form>
                          <form action={deleteFlow.bind(null, f.bf_id, back)}>
                            <ConfirmButton message={`Delete the flow “${f.bf_name}”? Running conversations stop.`} className="bf-danger" title="Delete" aria-label="Delete">
                              <i className="ri-delete-bin-line" />
                            </ConfirmButton>
                          </form>
                        </div>
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={7} className="text-center text-muted py-5">
                      {table.q ? 'No flows match this search.' : empty}
                      {!table.q && counts.size === 0 && (
                        <form action={createFlow} className="mt-3"><button type="submit" className="btn btn-success btn-sm"><i className="ri-add-line" /> Create your first flow</button></form>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination path={PATH} params={tableParams} page={table.page} perPage={table.perPage} total={total ?? 0} always />
        </div>
      </div>
    </>
  );
}
