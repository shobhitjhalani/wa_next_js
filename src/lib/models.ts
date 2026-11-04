import 'server-only';
import { exec, one, pool, query, value, type Queryable } from './db';
import { messagePreview } from './format';
import { limit } from './text';
import type { EmployeeRow, MessageRow } from './types';
import { SUPER_ADMIN } from './types';

/**
 * Small data-access helpers shared by pages, services and the worker
 * (ports of the Eloquent model methods).
 */

// ------------------------------------------------------------------ contacts / inbox

/** Find or create the contact row, filling in the name when it was missing. Returns cl_id (0 for none). */
export async function contactId(userId: number, mobile: string, name?: string | null, db: Queryable = pool): Promise<number> {
  mobile = String(mobile ?? '').trim();
  if (mobile === '' || mobile.includes(',')) return 0;
  mobile = limit(mobile, 15, '');
  const nm = name ? String(name) : null;

  const found = await one<{ cl_id: number; cl_name: string | null }>(
    'SELECT cl_id, cl_name FROM js_user_contact_list WHERE cl_user_id = $1 AND cl_mobile_no = $2',
    [userId, mobile], db,
  );
  if (found) {
    if (nm && !found.cl_name) await exec('UPDATE js_user_contact_list SET cl_name = $2 WHERE cl_id = $1', [found.cl_id, nm], db);
    return found.cl_id;
  }
  const id = await value<number>(
    `INSERT INTO js_user_contact_list (cl_user_id, cl_mobile_no, cl_name) VALUES ($1, $2, $3)
     ON CONFLICT (cl_user_id, cl_mobile_no) DO NOTHING RETURNING cl_id`,
    [userId, mobile, nm], db,
  );
  return id ?? (await value<number>('SELECT cl_id FROM js_user_contact_list WHERE cl_user_id = $1 AND cl_mobile_no = $2', [userId, mobile], db)) ?? 0;
}

/**
 * Move a message into its conversation summary (last message, unread count,
 * reply window) in one statement. Only moves forward, so a late-arriving
 * older message can't overwrite a newer preview.
 */
export async function recordMessage(
  m: Pick<MessageRow, 'm_id' | 'm_contact_id' | 'm_is_incoming' | 'm_is_read' | 'm_created_on' | 'm_content' | 'm_msg_type' | 'm_msg_template_name' | 'm_image'>,
  db: Queryable = pool,
): Promise<void> {
  if (!m.m_contact_id) return;
  const incoming = Number(m.m_is_incoming) === 1;
  await exec(
    `UPDATE js_user_contact_list SET
       cl_last_in = CASE WHEN $3 THEN GREATEST(cl_last_in, $4) ELSE cl_last_in END,
       cl_unread = cl_unread + $5,
       cl_last_msg = CASE WHEN cl_last_msg_id <= $2 THEN now() ELSE cl_last_msg END,
       cl_last_preview = CASE WHEN cl_last_msg_id <= $2 THEN $6 ELSE cl_last_preview END,
       cl_last_dir = CASE WHEN cl_last_msg_id <= $2 THEN $7 ELSE cl_last_dir END,
       cl_last_msg_id = GREATEST(cl_last_msg_id, $2)
     WHERE cl_id = $1`,
    [
      m.m_contact_id,
      m.m_id,
      incoming,
      Number(m.m_created_on) || Math.floor(Date.now() / 1000),
      incoming && Number(m.m_is_read) === 2 ? 1 : 0,
      limit(messagePreview(m), 250, '…'),
      incoming ? 1 : 2,
    ],
    db,
  );
}

/** Recount unread incoming messages after they were marked read elsewhere. */
export async function refreshUnread(userId: number, mobiles: string[], db: Queryable = pool): Promise<void> {
  const list = [...new Set(mobiles.filter(Boolean))];
  if (!list.length) return;
  await exec(
    `UPDATE js_user_contact_list c SET cl_unread = COALESCE((
       SELECT COUNT(*) FROM js_message m
        WHERE m.m_user_id = c.cl_user_id AND m.m_mobile_no = c.cl_mobile_no
          AND m.m_is_incoming = 1 AND m.m_is_read = 2 AND m.m_dstatus = 0), 0)
     WHERE c.cl_user_id = $1 AND c.cl_mobile_no = ANY($2::text[])`,
    [userId, list], db,
  );
}

/** Block (or re-block) a number; source 1 = manual, 2 = opt-out keyword. */
export async function blockNumber(userId: number, mobile: string, name: string | null | undefined, source: 1 | 2, db: Queryable = pool): Promise<void> {
  const nm = limit(String(name ?? '').trim(), 100, '') || null;
  const n = await exec(
    'UPDATE js_user_block_list SET ubl_name = $3, ubl_souce = $4, ubl_dstatus = 0 WHERE ubl_user_id = $1 AND ubl_mobile_no = $2',
    [userId, mobile, nm, source], db,
  );
  if (!n) {
    await exec('INSERT INTO js_user_block_list (ubl_user_id, ubl_mobile_no, ubl_name, ubl_souce, ubl_dstatus) VALUES ($1, $2, $3, $4, 0)', [userId, mobile, nm, source], db);
  }
}

// ------------------------------------------------------------------ masters

export interface Option {
  value: number | string;
  label: string;
}

/** id → name list for a master heading (active values), used by dropdowns. Ordered by name. */
export async function masterOptions(type: number): Promise<Option[]> {
  const rows = await query<{ mv_id: number; mv_name: string | null }>(
    'SELECT mv_id, mv_name FROM js_master_value WHERE mv_type = $1 AND mv_dstatus = 0 AND mv_status = 1 ORDER BY mv_name',
    [type],
  );
  return rows.map((r) => ({ value: r.mv_id, label: r.mv_name ?? '' }));
}

/** code → name list, for headings whose values are stored by mv_code (e.g. sheet types). */
export async function masterCodeOptions(type: number): Promise<Option[]> {
  const rows = await query<{ mv_code: string | null; mv_name: string | null }>(
    'SELECT mv_code, mv_name FROM js_master_value WHERE mv_type = $1 AND mv_dstatus = 0 ORDER BY mv_name',
    [type],
  );
  return rows.map((r) => ({ value: r.mv_code ?? '', label: r.mv_name ?? '' }));
}

export async function masterName(id: number | null | undefined): Promise<string> {
  if (!id) return '';
  return (await value<string>('SELECT mv_name FROM js_master_value WHERE mv_id = $1', [id])) ?? '';
}

// ------------------------------------------------------------------ staff rights

/**
 * Legacy fun_check_rights: super admins see everything, every employee sees
 * the dashboard, users and reports; other pages need a
 * "<module code>_<action id>" row in js_employee_rights. `page` matches the
 * module's mo_page (e.g. "masters", "employee") or its name.
 */
export async function employeeCanAccess(emp: Pick<EmployeeRow, 'emp_id' | 'emp_m_type'>, page: string, action = 'View'): Promise<boolean> {
  if (Number(emp.emp_m_type) === SUPER_ADMIN || ['dashboard', 'user', 'reports'].includes(page)) return true;
  const ok = await value<boolean>(
    `SELECT EXISTS (
       SELECT 1 FROM js_employee_rights r
         JOIN js_modules mo ON r.er_page_action = mo.mo_code || '_' || (SELECT ma_id FROM js_m_actions WHERE LOWER(ma_name) = LOWER($3) LIMIT 1)
        WHERE r.er_dstatus = 0 AND r.er_emp_id = $1 AND (mo.mo_page = $2 OR LOWER(mo.mo_name) = LOWER($2)))`,
    [emp.emp_id, page, action],
  );
  return !!ok;
}
