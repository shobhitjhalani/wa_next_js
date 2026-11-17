import 'server-only';
import { forbidden, notFound } from 'next/navigation';
import { cache } from 'react';
import { requireAdmin, type Admin } from './auth';
import { one, query } from './db';
import { USER_TYPE } from './types';

/**
 * Team rights for the admin panel. Super admins can do everything; a team member
 * only what js_employee_rights grants (ticked on the Team Member form):
 *
 *   user_wa / user_gs   WhatsApp / Corporate users — View, Add, Edit, Delete, All.
 *                       Without "All" a member only sees the users assigned to them
 *                       (js_user.u_assign_to).
 *   reports_messages    Message reports — View; Edit = bulk delete / re-queue.
 *   reports_recharges   Recharge reports and revenue — View.
 *
 * Reports, message lists and the dashboard only include the users the member can see
 * (visibleUserIds).
 */

export type Right = 'view' | 'add' | 'edit' | 'delete' | 'all';
export const USERS_WA = 'user_wa';
export const USERS_CORPORATE = 'user_gs';
export const MESSAGE_REPORTS = 'reports_messages';
export const RECHARGE_REPORTS = 'reports_recharges';

/** Rights module of a user type. */
export const userModule = (type: number) => (Number(type) === USER_TYPE.WHATSAPP ? USERS_WA : USERS_CORPORATE);

export interface Access {
  admin: Admin;
  /** "view" is also granted by "all". */
  can(page: string, right?: Right): boolean;
  /** May see every user of this type (not just the assigned ones). */
  seesAll(type: number): boolean;
}

/** `page:right` pairs granted to a team member. */
const grantedRights = cache(async (empId: number): Promise<Set<string>> => {
  const rows = await query<{ k: string }>(
    `SELECT DISTINCT mo.mo_page || ':' || LOWER(ma.ma_name) AS k
       FROM js_employee_rights r
       JOIN js_modules mo ON mo.mo_status = 1
       JOIN js_m_actions ma ON r.er_page_action = mo.mo_code || '_' || ma.ma_id
      WHERE r.er_emp_id = $1 AND r.er_dstatus = 0`,
    [empId],
  );
  return new Set(rows.map((r) => r.k));
});

const accessOf = cache(async (admin: Admin): Promise<Access> => {
  const rights = admin.isSuperAdmin ? new Set<string>() : await grantedRights(admin.emp_id);
  const can = (page: string, right: Right = 'view') =>
    admin.isSuperAdmin || rights.has(`${page}:${right}`) || (right === 'view' && rights.has(`${page}:all`));
  return { admin, can, seesAll: (type) => can(userModule(type), 'all') };
});

/** The signed-in staff member's rights (redirects to the login page when signed out). */
export async function getAccess(): Promise<Access> {
  return accessOf(await requireAdmin());
}

/** Page / action guard: 403 unless the member has `right` on `page`. */
export async function requireRight(page: string, right: Right = 'view'): Promise<Access> {
  const access = await getAccess();
  if (!access.can(page, right)) forbidden();
  return access;
}

/** Whether this member may see the user (by type right and assignment). */
export function canSeeUser(access: Access, user: { u_type: number; u_assign_to: number | null }): boolean {
  if (!access.can(userModule(user.u_type))) return false;
  return access.seesAll(user.u_type) || Number(user.u_assign_to) === access.admin.emp_id;
}

/**
 * Guard for one client account: 404 when the member can't see it (not assigned to them,
 * no right on its type, or deleted), 403 when they see it but lack `right`.
 */
export async function requireUserRight(id: number, right: Right = 'view') {
  const access = await getAccess();
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const user = await one<{ u_id: number; u_type: number; u_assign_to: number }>(
    'SELECT u_id, u_type, u_assign_to FROM js_user WHERE u_id = $1 AND u_dstatus = 0', [id]);
  if (!user || !canSeeUser(access, user)) notFound();
  if (!access.can(userModule(user.u_type), right)) forbidden();
  return { access, user };
}

/**
 * Users whose data (messages, campaigns, recharges, sheets) this member may see, or null
 * when they may see everyone. Deleted users are included so their history stays visible.
 * Use in SQL as `($n::int[] IS NULL OR col = ANY($n::int[]))`.
 */
export const visibleUserIds = cache(async (): Promise<number[] | null> => {
  const access = await getAccess();
  const { admin } = access;
  const wa = access.can(USERS_WA);
  const corp = access.can(USERS_CORPORATE);
  const waAll = access.seesAll(USER_TYPE.WHATSAPP);
  const corpAll = access.seesAll(USER_TYPE.CORPORATE);
  if (admin.isSuperAdmin || (waAll && corpAll)) return null;
  const rows = await query<{ u_id: number }>(
    `SELECT u_id FROM js_user
      WHERE (u_type = $1 AND $2::bool AND ($3::bool OR u_assign_to = $6))
         OR (u_type <> $1 AND $4::bool AND ($5::bool OR u_assign_to = $6))`,
    [USER_TYPE.WHATSAPP, wa, waAll, corp, corpAll, admin.emp_id],
  );
  return rows.map((r) => r.u_id);
});

/** Assigned-to filter for a user list of one type: the member's id, or null when they see all. */
export function assignFilter(access: Access, type: number): number | null {
  return access.seesAll(type) ? null : access.admin.emp_id;
}
