import ExcelJS from 'exceljs';
import { requireBotUser } from '@/lib/auth';
import { flowVariables, outputs, type FlowGraph } from '@/lib/bot-flow';
import { one, query } from '@/lib/db';
import { parseDateRange, phpDate } from '@/lib/time';

const STATUS: Record<number, string> = { 1: 'Running', 2: 'Completed', 3: 'Expired', 4: 'Stopped' };
/** Kept by the engine, not answers of a step. */
const HIDDEN = new Set(['last_reply', 'trigger']);

/**
 * Variables in the order the steps come in the flow: from the trigger along the connections
 * (each step's outputs in order), then steps not connected.
 */
function stepOrder(graph: FlowGraph): string[] {
  const nodes = graph.nodes ?? [];
  const seen = new Set<string>();
  const ordered: FlowGraph['nodes'] = [];
  const queue = nodes.filter((n) => n.type === 'trigger').map((n) => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = nodes.find((n) => n.id === id);
    if (!node) continue;
    ordered.push(node);
    for (const o of outputs(node)) {
      const e = (graph.edges ?? []).find((x) => x.source === id && (x.sourceHandle ?? null) === o.id);
      if (e) queue.push(e.target);
    }
  }
  for (const n of nodes) if (!seen.has(n.id)) ordered.push(n);
  return flowVariables({ ...graph, nodes: ordered });
}

/** Excel of a flow's conversations: Started, Last activity, Status, Mobile, Name, trigger, then one column per saved step answer. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireBotUser();
  const id = Number((await params).id);
  const flow = Number.isInteger(id) ? await one<{ bf_id: number; bf_name: string; bf_graph: FlowGraph }>(
    'SELECT bf_id, bf_name, bf_graph FROM js_bot_flow WHERE bf_id = $1 AND bf_user_id = $2', [id, user.u_id]) : null;
  if (!flow) return new Response('Not found', { status: 404 });

  const url = new URL(req.url);
  const status = Number(url.searchParams.get('status')) || 0;
  const mobile = (url.searchParams.get('mobile') ?? '').replace(/\D/g, '');
  const range = parseDateRange(url.searchParams.get('started'));
  const rows = await query<{ bs_mobile: string; bs_name: string | null; bs_status: number; bs_vars: Record<string, string>; bs_created_on: number; bs_updated_on: number }>(
    `SELECT bs_mobile, bs_name, bs_status, bs_vars, bs_created_on, bs_updated_on FROM js_bot_session
      WHERE bs_flow_id = $1 AND bs_user_id = $2 AND ($3 = 0 OR bs_status = $3) AND ($4 = '' OR bs_mobile LIKE '%' || $4 || '%')
        AND bs_created_on >= $5 AND bs_created_on < $6
      ORDER BY bs_id DESC LIMIT 100000`, [flow.bf_id, user.u_id, status, mobile, range?.[0] ?? 0, range?.[1] ?? 2147483647]);

  // Step answers: the flow's variables in step order, then any older ones only conversations still hold
  const inFlow = stepOrder(flow.bf_graph).filter((k) => !HIDDEN.has(k));
  const extra = [...new Set(rows.flatMap((r) => Object.keys(r.bs_vars ?? {})))].filter((k) => !HIDDEN.has(k) && !inFlow.includes(k));
  const vars = [...inFlow, ...extra];

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Conversations');
  ws.columns = [
    { header: 'Started', key: 'started', width: 20 },
    { header: 'Last activity', key: 'last', width: 20 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Mobile', key: 'mobile', width: 16, style: { numFmt: '@' } },
    { header: 'Name', key: 'name', width: 22 },
    { header: 'trigger', key: 'trigger', width: 18 },
    ...vars.map((k, i) => ({ header: k, key: `v${i}`, width: Math.min(40, Math.max(14, k.length + 4)) })),
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of rows) {
    const row: Record<string, string> = {
      started: phpDate('d-m-Y h:i A', Number(r.bs_created_on)),
      last: phpDate('d-m-Y h:i A', Number(r.bs_updated_on)),
      status: STATUS[Number(r.bs_status)] ?? '',
      mobile: r.bs_mobile,
      name: r.bs_name ?? '',
      trigger: r.bs_vars?.trigger ?? '',
    };
    vars.forEach((k, i) => { row[`v${i}`] = r.bs_vars?.[k] ?? ''; });
    ws.addRow(row);
  }

  const body = await wb.xlsx.writeBuffer();
  const name = flow.bf_name.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60) || 'flow';
  return new Response(body as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}_conversations.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
