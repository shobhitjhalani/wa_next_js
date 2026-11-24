'use server';

import { revalidatePath } from 'next/cache';
import { fail, fStr, invalid, ok, type ActionResult } from '@/lib/actions';
import { logActivity } from '@/lib/activity';
import { requireUserRight } from '@/lib/admin-access';
import { config } from '@/lib/config';
import { insert, one, update, value } from '@/lib/db';
import { numberFormat } from '@/lib/text';
import { now } from '@/lib/time';
import { USER_TYPE } from '@/lib/types';

/**
 * Custom WA plans of one WhatsApp user (admin → user page → Custom Plans). Stored as WA plans
 * (js_master_value type 82, validity plan) with mv_user_id = the user, so payment and recharge work as for any plan.
 * While the user has an active custom plan, Plans → Recharge shows only their custom plans.
 */

const showPath = (id: number) => `/wamaster/users/${id}`;

async function waUser(id: number) {
  await requireUserRight(id, 'edit');
  return one<{ u_id: number; label: string }>(
    `SELECT u_id, COALESCE(NULLIF(u_company_name, ''), u_name, '') || ' (' || COALESCE(u_username, '') || ') #' || u_id AS label
       FROM js_user WHERE u_id = $1 AND u_dstatus = 0 AND u_type = $2`, [id, USER_TYPE.WHATSAPP]);
}

async function ownPlan(userId: number, planId: number) {
  return one<{ mv_id: number; mv_name: string | null; mv_status: number }>(
    'SELECT mv_id, mv_name, mv_status FROM js_master_value WHERE mv_id = $1 AND mv_type = $2 AND mv_user_id = $3 AND mv_dstatus = 0',
    [planId, config.masters.waPlan, userId]);
}

/** Add (planId null) or edit a custom plan. */
export async function saveCustomPlan(userId: number, planId: number | null, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await waUser(userId);
  if (!user) return fail('User not found.');
  if (planId !== null && !(await ownPlan(userId, planId))) return fail('Plan not found.');

  const name = fStr(fd, 'plan_name');
  const days = fStr(fd, 'plan_days');
  const amount = fStr(fd, 'plan_amount');
  const desc = fStr(fd, 'plan_desc');
  const errors: Record<string, string> = {};
  if (!name) errors.plan_name = 'The title field is required.';
  else if (name.length > 255) errors.plan_name = 'The title must not be greater than 255 characters.';
  if (!/^\d{1,4}$/.test(days) || Number(days) < 1 || Number(days) > 3650) errors.plan_days = 'The validity must be between 1 and 3650 days.';
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) errors.plan_amount = 'The amount must be a number greater than 0 (up to 2 decimals).';
  if (desc.length > 2000) errors.plan_desc = 'The description must not be greater than 2000 characters.';
  if (Object.keys(errors).length) return invalid(errors);

  const row = {
    mv_name: name, mv_desc: desc || null, mv_value: String(Number(days)), mv_value1: '2',
    mv_value_decimal: Number(amount), mv_updated_on: now(),
  };
  if (planId === null) {
    const order = (await value<number>('SELECT COALESCE(MAX(mv_display_order), 0)::int + 1 FROM js_master_value WHERE mv_type = $1 AND mv_user_id = $2 AND mv_dstatus = 0',
      [config.masters.waPlan, userId])) ?? 1;
    await insert('js_master_value', { ...row, mv_type: config.masters.waPlan, mv_user_id: userId, mv_status: 1, mv_display_order: order }, 'mv_id');
  } else {
    await update('js_master_value', row, 'mv_id = $1 AND mv_user_id = $2', [planId, userId]);
  }
  await logActivity({
    module: 'users', action: planId === null ? 'Added custom plan' : 'Updated custom plan', target: user.label, targetId: userId,
    details: [`Plan: ${name}`, `Validity: ${Number(days)} days`, `Amount (before GST): Rs. ${numberFormat(Number(amount), 2)}`],
  });
  revalidatePath(showPath(userId));
  return ok(planId === null ? 'Custom plan added. The user now sees only their custom plans.' : 'Custom plan saved.');
}

/** Switch a custom plan on / off (off = hidden from the user; with none on, the user sees the global plans). */
export async function toggleCustomPlan(userId: number, planId: number): Promise<void> {
  const user = await waUser(userId);
  const plan = user ? await ownPlan(userId, planId) : null;
  if (!user || !plan) return;
  const status = Number(plan.mv_status) === 1 ? 2 : 1;
  await update('js_master_value', { mv_status: status, mv_updated_on: now() }, 'mv_id = $1 AND mv_user_id = $2', [planId, userId]);
  await logActivity({ module: 'users', action: `${status === 1 ? 'Activated' : 'Deactivated'} custom plan`, target: user.label, targetId: userId, details: [`Plan: ${plan.mv_name ?? ''}`] });
  revalidatePath(showPath(userId));
}

/** Delete a custom plan (soft delete; past recharges keep their plan name). */
export async function deleteCustomPlan(userId: number, planId: number): Promise<void> {
  const user = await waUser(userId);
  const plan = user ? await ownPlan(userId, planId) : null;
  if (!user || !plan) return;
  await update('js_master_value', { mv_dstatus: 1, mv_updated_on: now() }, 'mv_id = $1 AND mv_user_id = $2', [planId, userId]);
  await logActivity({ module: 'users', action: 'Deleted custom plan', target: user.label, targetId: userId, details: [`Plan: ${plan.mv_name ?? ''}`] });
  revalidatePath(showPath(userId));
}
