import { requireUser } from '@/lib/auth';
import { one, query } from '@/lib/db';
import { csvFromRows } from '@/lib/http';
import { phpDate } from '@/lib/time';

const STATUS: Record<number, string> = { 1: 'Running', 2: 'Completed', 3: 'Expired', 4: 'Stopped' };

/** CSV of a flow's conversations with one column per saved variable. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = Number((await params).id);
  const flow = Number.isInteger(id) ? await one<{ bf_id: number; bf_name: string }>(
    'SELECT bf_id, bf_name FROM js_bot_flow WHERE bf_id = $1 AND bf_user_id = $2', [id, user.u_id]) : null;
  if (!flow) return new Response('Not found', { status: 404 });

  const url = new URL(req.url);
  const status = Number(url.searchParams.get('status')) || 0;
  const mobile = (url.searchParams.get('mobile') ?? '').replace(/\D/g, '');
  const rows = await query<{ bs_mobile: string; bs_name: string | null; bs_status: number; bs_vars: Record<string, string>; bs_created_on: number; bs_updated_on: number }>(
    `SELECT bs_mobile, bs_name, bs_status, bs_vars, bs_created_on, bs_updated_on FROM js_bot_session
      WHERE bs_flow_id = $1 AND bs_user_id = $2 AND ($3 = 0 OR bs_status = $3) AND ($4 = '' OR bs_mobile LIKE '%' || $4 || '%')
      ORDER BY bs_id DESC LIMIT 100000`, [flow.bf_id, user.u_id, status, mobile]);

  const vars = [...new Set(rows.flatMap((r) => Object.keys(r.bs_vars ?? {})))].filter((k) => k !== 'last_reply');
  const header = ['Mobile', 'Name', 'Status', 'Started', 'Last activity', ...vars];
  const data = rows.map((r) => [
    r.bs_mobile, r.bs_name ?? '', STATUS[Number(r.bs_status)] ?? '', phpDate('d-m-Y H:i', r.bs_created_on), phpDate('d-m-Y H:i', r.bs_updated_on),
    ...vars.map((k) => r.bs_vars?.[k] ?? ''),
  ]);
  const name = flow.bf_name.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60) || 'flow';
  return csvFromRows(`${name}_conversations.csv`, header, data);
}
