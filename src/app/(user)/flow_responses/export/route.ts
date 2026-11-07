import { NextResponse, type NextRequest } from 'next/server';
import { getUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { flowAnswers } from '@/lib/flow-response';
import { csvFromRows } from '@/lib/http';
import { phpDate } from '@/lib/time';
import { filterWhere, readFilter } from '../filter';

const MAX_ROWS = 50_000;

/** GET /flow_responses/export — filtered flow responses as CSV, one column per question. */
export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL('/', req.url));

  const args: unknown[] = [];
  const where = filterWhere(user.u_id, readFilter(req.nextUrl.searchParams), args);
  const rows = await query<{ fr_created_on: number; fr_sender_name: string | null; fr_mobile_no: string | null; fr_template_name: string | null; fr_response: unknown }>(
    `SELECT fr_created_on, fr_sender_name, fr_mobile_no, fr_template_name, fr_response
       FROM js_flow_responses WHERE ${where} ORDER BY fr_id LIMIT ${MAX_ROWS}`,
    args,
  );

  // Questions become columns, in the order they first appear
  const columns: string[] = [];
  const seen = new Set<string>();
  const parsed = rows.map((r) => {
    const answers = new Map<string, string>();
    for (const a of flowAnswers(r.fr_response)) {
      if (!seen.has(a.label)) { seen.add(a.label); columns.push(a.label); }
      answers.set(a.label, answers.has(a.label) ? `${answers.get(a.label)}, ${a.value}` : a.value);
    }
    return { r, answers };
  });

  return csvFromRows(
    `flow-responses-${phpDate('Y-m-d')}.csv`,
    ['Date', 'Name', 'Mobile', 'Template', ...columns],
    parsed.map(({ r, answers }) => [
      r.fr_created_on ? phpDate('d-m-Y H:i', Number(r.fr_created_on)) : '',
      r.fr_sender_name ?? '', r.fr_mobile_no ?? '', r.fr_template_name ?? '',
      ...columns.map((c) => answers.get(c) ?? ''),
    ]),
  );
}
