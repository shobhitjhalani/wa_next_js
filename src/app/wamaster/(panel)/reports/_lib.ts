import 'server-only';
import { query } from '@/lib/db';
import { int } from '@/lib/text';
import { parseDateRange, todayString } from '@/lib/time';
import { USER_TYPE } from '@/lib/types';

export type Params = Record<string, string | string[] | undefined>;

/** Raw query value like Laravel $request->input(): undefined when the key is absent. */
export function input(params: Params, key: string): string | undefined {
  const v = params[key];
  if (v === undefined) return undefined;
  return (Array.isArray(v) ? v[0] ?? '' : v).trim();
}

/** $request->filled(key) */
export const filled = (params: Params, key: string) => (input(params, key) ?? '') !== '';

/** The wa_date filter value, defaulting to today when absent (`$request->input('wa_date', DateRange::today())`). */
export function dateInput(params: Params, defaultToday: boolean): string {
  return input(params, 'wa_date') ?? (defaultToday ? todayString() : '');
}

/** Inclusive [start, end] bounds like Laravel whereBetween($range). */
export function dateRange(value: string): [number, number] | null {
  const r = parseDateRange(value);
  return r ? [r[0], r[1]] : null;
}

/** Laravel compared request ids against int columns; non-numeric input matched nothing. */
export const intParam = (params: Params, key: string) => int(input(params, key));

/** WhatsApp users for the filter dropdowns (u_id → u_username). */
export function waUsers(): Promise<{ u_id: number; u_username: string | null }[]> {
  return query('SELECT u_id, u_username FROM js_user WHERE u_dstatus = 0 AND u_type = $1 ORDER BY u_username', [USER_TYPE.WHATSAPP]);
}

/** Corporate accounts (u_id → u_name). */
export function corporates(): Promise<{ u_id: number; u_name: string | null }[]> {
  return query('SELECT u_id, u_name FROM js_user WHERE u_dstatus = 0 AND u_type = $1 ORDER BY u_name', [USER_TYPE.CORPORATE]);
}

/** Message report types (ReportController::MESSAGE_REPORTS). */
export const MESSAGE_REPORTS: Record<string, string> = {
  send: 'WA Send Report',
  que: 'WA Que',
  error: 'WA Error',
  failed: 'WA Failed',
  in_process: 'WA In Process',
};

/**
 * WHERE clause of ReportController::messageQuery. Each base condition is
 * written to match a partial index in db/schema.sql:
 *  que        → js_message_queue_idx       (m_status = 1 AND m_is_incoming = 2 AND m_dstatus = 0)
 *  in_process → js_message_processing_idx  (m_status = 6 AND m_is_incoming = 2 AND m_dstatus = 0)
 *  date range → js_message_created_idx     (m_created_on)
 *  user       → js_message_user_dir_status_idx (m_user_id, m_is_incoming, …)
 * Returns the conditions without the status filters (dst / st) separately so
 * the "send" stats can count on the same scan.
 */
export function messageWhere(params: Params, type: string): { where: string; statusWhere: string; args: unknown[]; ranged: boolean } {
  const args: unknown[] = [];
  const p = (v: unknown) => { args.push(v); return `$${args.length}`; };
  const c: string[] = ['m_is_incoming = 2', 'm_dstatus = 0'];
  if (type === 'que') c.push('m_status = 1');
  if (type === 'in_process') c.push('m_status = 6');
  if (type === 'error') c.push("((m_status = 3 AND m_message_id = '') OR m_status = 4)");
  if (type === 'failed') c.push("m_status <> 1 AND m_delivery_status = 'failed'");

  const range = dateRange(dateInput(params, ['send', 'error', 'failed'].includes(type)));
  if (range) c.push(`m_created_on BETWEEN ${p(range[0])} AND ${p(range[1])}`);
  if (filled(params, 'user_id')) c.push(`m_user_id = ${p(intParam(params, 'user_id'))}`);
  if (filled(params, 'mobile_no')) c.push(`m_mobile_no = ${p(input(params, 'mobile_no'))}`);
  if (filled(params, 'sheet_id')) c.push(`m_sheet_id = ${p(input(params, 'sheet_id'))}`);
  const template = input(params, 'template') ?? '';
  if (template === '-1') c.push("(m_msg_template_name IS NULL OR m_msg_template_name = '')");
  else if (template !== '') c.push(`m_msg_template_name = ${p(template)}`);
  const msgType = input(params, 'msg_type');
  if (msgType === '1') c.push("m_msg_type = 'template'");
  if (msgType === '2') c.push("m_msg_type <> 'template'");

  const s: string[] = [];
  if (filled(params, 'dst')) s.push(`m_delivery_status = ${p(input(params, 'dst'))}`);
  if (filled(params, 'st')) s.push(`m_status = ${p(intParam(params, 'st'))}`);

  return { where: c.join(' AND '), statusWhere: s.length ? s.join(' AND ') : 'TRUE', args, ranged: !!range };
}

/**
 * ORDER BY for message lists. Laravel ordered by m_id DESC; with a date range
 * we order by (m_created_on, m_id) DESC instead so PostgreSQL walks
 * js_message_created_idx backwards and stops after one page — ordering by the
 * primary key made it scan the whole table backwards for older ranges (24 s
 * for a month in early 2025). m_id and m_created_on grow together, so the
 * order is the same.
 */
export const messageOrder = (ranged: boolean) => (ranged ? 'm_created_on DESC, m_id DESC' : 'm_id DESC');
