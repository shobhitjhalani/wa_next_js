import { sp } from '@/lib/http';
import { like } from '@/lib/db';
import { messageStatusLabel } from '@/lib/format';
import { parseDateRange } from '@/lib/time';

/** Filters of the quick reply Sent Log, shared by the page and its Excel export. */
export interface LogFilter {
  date: string;   // "d-m-Y to d-m-Y"
  reply: string;  // quick reply id ('' = all)
  q: string;      // mobile or name
}

export function readLogFilter(params: Record<string, string | string[] | undefined> | URLSearchParams): LogFilter {
  const reply = sp(params, 'reply');
  return { date: sp(params, 'date').trim(), reply: /^\d+$/.test(reply) ? reply : '', q: sp(params, 'q').trim().slice(0, 100) };
}

/** The filters as a query string (for links / the export). */
export function logQuery(f: LogFilter, extra: Record<string, string> = {}): string {
  const qs = new URLSearchParams();
  if (f.date) qs.set('date', f.date);
  if (f.reply) qs.set('reply', f.reply);
  if (f.q) qs.set('q', f.q);
  for (const [k, v] of Object.entries(extra)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/** WHERE clause on js_quick_reply_log l for the user; pushes values onto `args`. */
export function logWhere(userId: number, f: LogFilter, args: unknown[]): string {
  args.push(userId);
  let where = `l.ql_user_id = $${args.length}`;
  const range = parseDateRange(f.date);
  if (range) {
    args.push(range[0], range[1]);
    where += ` AND l.ql_sent_on >= $${args.length - 1} AND l.ql_sent_on < $${args.length}`;
  }
  if (f.reply) { args.push(Number(f.reply)); where += ` AND l.ql_qr_id = $${args.length}`; }
  if (f.q) {
    args.push(`%${like(f.q)}%`);
    where += ` AND (l.ql_mobile ILIKE $${args.length} OR l.ql_name ILIKE $${args.length})`;
  }
  return where;
}

/** Columns of a log row: the reply message's status comes from js_message. */
export const LOG_SELECT = `
  SELECT l.ql_id, l.ql_qr_id, l.ql_qr_name, l.ql_mobile, l.ql_name, l.ql_text, l.ql_keyword, l.ql_sent_on,
         m.m_status, m.m_message_id, m.m_delivery_status, m.m_status_response
    FROM js_quick_reply_log l LEFT JOIN js_message m ON m.m_id = l.ql_m_id`;

export interface LogRow {
  ql_id: number; ql_qr_id: number; ql_qr_name: string; ql_mobile: string; ql_name: string | null; ql_text: string | null; ql_keyword: string | null; ql_sent_on: number;
  m_status: number | null; m_message_id: string | null; m_delivery_status: string | null; m_status_response: string | null;
}

/** The reply message's status as the reports show it (sent / delivered / read / error / queued). */
export function logStatus(r: LogRow): string {
  if (r.m_status === null || r.m_status === undefined) return '—';
  return messageStatusLabel({
    m_status: Number(r.m_status), m_message_id: r.m_message_id ?? '', m_delivery_status: r.m_delivery_status ?? '', m_status_response: r.m_status_response ?? '',
  } as Parameters<typeof messageStatusLabel>[0]) || '—';
}
