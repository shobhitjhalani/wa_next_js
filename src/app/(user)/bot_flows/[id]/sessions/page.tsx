import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageTitle } from '@/components/PageTitle';
import { Pagination, pageParam } from '@/components/Pagination';
import { requireUser } from '@/lib/auth';
import { NODE_INFO, type FlowGraph } from '@/lib/bot-flow';
import { one, query, value } from '@/lib/db';
import { sp } from '@/lib/http';
import { phpDate } from '@/lib/time';

export const metadata: Metadata = { title: 'Flow Conversations' };

const PER_PAGE = 50;
const SESSION_STATUS: Record<number, [string, string]> = {
  1: ['Running', 'bg-info'], 2: ['Completed', 'bg-success'], 3: ['Expired', 'bg-warning'], 4: ['Stopped', 'bg-secondary'],
};

interface Session {
  bs_id: number; bs_mobile: string; bs_name: string | null; bs_node: string | null; bs_wait_until: number;
  bs_vars: Record<string, string>; bs_status: number; bs_created_on: number; bs_updated_on: number;
}

/** A flow's conversations: who is where, and the answers / webhook values saved so far. */
export default async function FlowSessionsPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const id = Number((await params).id);
  const sParams = await searchParams;
  const flow = Number.isInteger(id) ? await one<{ bf_id: number; bf_name: string; bf_graph: FlowGraph }>(
    'SELECT bf_id, bf_name, bf_graph FROM js_bot_flow WHERE bf_id = $1 AND bf_user_id = $2', [id, user.u_id]) : null;
  if (!flow) notFound();

  const status = Number(sp(sParams, 'status')) || 0;
  const mobile = (sp(sParams, 'mobile') ?? '').replace(/\D/g, '');
  const page = pageParam(sParams.page);
  const where = 'bs_flow_id = $1 AND bs_user_id = $2 AND ($3 = 0 OR bs_status = $3) AND ($4 = \'\' OR bs_mobile LIKE \'%\' || $4 || \'%\')';
  const args = [flow.bf_id, user.u_id, status, mobile];
  const [rows, total] = await Promise.all([
    query<Session>(`SELECT * FROM js_bot_session WHERE ${where} ORDER BY bs_id DESC LIMIT ${PER_PAGE} OFFSET ${(page - 1) * PER_PAGE}`, args),
    value<number>(`SELECT COUNT(*)::int FROM js_bot_session WHERE ${where}`, args),
  ]);
  const nodes = new Map((flow.bf_graph.nodes ?? []).map((n) => [n.id, n]));
  const exportQs = new URLSearchParams({ ...(status ? { status: String(status) } : {}), ...(mobile ? { mobile } : {}) }).toString();

  return (
    <>
      <PageTitle title="Flow Conversations" home="/dashboard" />
      <div className="card">
        <div className="card-header d-flex align-items-center flex-wrap gap-2">
          <div className="me-auto">
            <h5 className="card-title mb-0">{flow.bf_name}</h5>
            <p className="text-muted small mb-0">Each contact's progress through the flow and the answers saved in its variables.</p>
          </div>
          <Link href={`/bot_flows/${flow.bf_id}`} className="btn btn-sm btn-soft-primary"><i className="ri-edit-line" /> Edit flow</Link>
          <a href={`/bot_flows/${flow.bf_id}/sessions/export${exportQs ? '?' + exportQs : ''}`} className="btn btn-sm btn-soft-success"><i className="ri-file-excel-2-line" /> Export CSV</a>
        </div>
        <div className="card-body border-bottom">
          <form method="get" className="row g-2 align-items-center">
            <div className="col-auto">
              <select name="status" className="form-select form-select-sm" defaultValue={status || ''}>
                <option value="">All statuses</option>
                {Object.entries(SESSION_STATUS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </div>
            <div className="col-auto"><input name="mobile" className="form-control form-control-sm" placeholder="Mobile number" defaultValue={mobile} /></div>
            <div className="col-auto"><button type="submit" className="btn btn-sm btn-primary"><i className="ri-search-line" /> Filter</button></div>
          </form>
        </div>
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light">
              <tr><th>Contact</th><th>Status</th><th>Current step</th><th>Saved answers</th><th>Started</th><th>Last activity</th></tr>
            </thead>
            <tbody>
              {rows.length ? rows.map((s) => {
                const [label, cls] = SESSION_STATUS[Number(s.bs_status)] ?? ['—', 'bg-light text-body'];
                const node = s.bs_node ? nodes.get(s.bs_node) : null;
                const vars = Object.entries(s.bs_vars ?? {}).filter(([k]) => k !== 'last_reply' && k !== 'trigger');
                return (
                  <tr key={s.bs_id}>
                    <td>
                      <Link href={`/chat?mb=${encodeURIComponent(s.bs_mobile)}`} className="fw-semibold">{s.bs_mobile}</Link>
                      {s.bs_name && <div className="small text-muted">{s.bs_name}</div>}
                    </td>
                    <td><span className={`badge ${cls}`}>{label}</span></td>
                    <td className="small">
                      {Number(s.bs_status) === 1 && node ? (
                        <>
                          <i className={`${NODE_INFO[node.type].icon} me-1`} />{NODE_INFO[node.type].label}
                          <div className="text-muted">{s.bs_wait_until ? `continues ${phpDate('d M, h:i A', s.bs_wait_until)}` : 'waiting for reply'}</div>
                        </>
                      ) : '—'}
                    </td>
                    <td className="small" style={{ maxWidth: 420 }}>
                      {vars.length ? vars.map(([k, v]) => (
                        <div key={k} className="text-truncate" title={String(v)}><code>{k}</code>: {String(v)}</div>
                      )) : <span className="text-muted">—</span>}
                    </td>
                    <td className="small text-nowrap">{phpDate('d M Y, h:i A', s.bs_created_on)}</td>
                    <td className="small text-nowrap">{phpDate('d M Y, h:i A', s.bs_updated_on)}</td>
                  </tr>
                );
              }) : (
                <tr><td colSpan={6} className="text-center text-muted py-4">No conversations yet. Activate the flow and send one of its keywords to your WhatsApp number to try it.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="card-body">
          <Pagination path={`/bot_flows/${flow.bf_id}/sessions`} params={sParams} page={page} perPage={PER_PAGE} total={total ?? 0} />
        </div>
      </div>
    </>
  );
}
