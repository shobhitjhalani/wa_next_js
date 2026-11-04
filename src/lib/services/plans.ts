import 'server-only';
import { config } from '../config';
import { exec, insert, one, query, tx, value } from '../db';
import { dayStart, now, phpDate } from '../time';
import { USER_TYPE, type MasterValueRow, type PaymentLogRow, type RechargeRow, type UserRow } from '../types';

/**
 * Plans are js_master_value rows of type 82:
 *   mv_value = validity days, mv_value1 = plan type (1 add-on, 2 validity, 3 trial),
 *   mv_value_decimal = price before GST.
 * Port of Frontend::fun_updated_user_plan / User::fun_recharge / fun_payment_log_add.
 */

export async function listPlans(includeTrial = false): Promise<MasterValueRow[]> {
  return query<MasterValueRow>(
    `SELECT * FROM js_master_value WHERE mv_type = $1 AND mv_dstatus = 0 AND mv_status = 1
       ${includeTrial ? '' : "AND mv_value1 = '2' AND mv_value_decimal > 0"}
     ORDER BY mv_display_order`,
    [config.masters.waPlan],
  );
}

export async function findPlan(id: number): Promise<MasterValueRow | null> {
  return one<MasterValueRow>('SELECT * FROM js_master_value WHERE mv_id = $1 AND mv_type = $2 AND mv_dstatus = 0', [id, config.masters.waPlan]);
}

export function gstOf(amount: number): number {
  return Math.round(amount * config.payment.gstPercent) / 100;
}

/** Outstanding balance on the parent account. */
export async function outstanding(user: Pick<UserRow, 'u_parent_id'>): Promise<number> {
  return user.u_parent_id ? Number((await value<number>('SELECT u_balance FROM js_user WHERE u_id = $1', [user.u_parent_id])) ?? 0) : 0;
}

/** Amount the user pays: plan + GST + any outstanding balance on the parent account. */
export async function payableAmount(user: Pick<UserRow, 'u_parent_id'>, plan: Pick<MasterValueRow, 'mv_value_decimal'>): Promise<number> {
  const amount = Number(plan.mv_value_decimal);
  return Math.round((amount + gstOf(amount) + (await outstanding(user))) * 100) / 100;
}

export async function startPayment(user: Pick<UserRow, 'u_id' | 'u_parent_id'>, plan: MasterValueRow, ip: string): Promise<PaymentLogRow> {
  const log = await insert<PaymentLogRow>('js_payment_log', {
    p_gateway: config.payment.gateway,
    p_user_id: user.u_id,
    p_status: 1,
    p_amount: await payableAmount(user, plan),
    p_order_no: plan.mv_id,
    p_plan_id: plan.mv_id,
    p_ip_address: ip,
  });
  const pNo = `PL-${phpDate('ymd')}-${log.p_id}`;
  await exec('UPDATE js_payment_log SET p_no = $2 WHERE p_id = $1', [log.p_id, pNo]);
  return { ...log, p_no: pNo };
}

export interface RechargeDetails {
  received?: number;
  invoice?: number;
  source?: number;
  paymentLogId?: number;
  refNo?: string | null;
  status?: number;
  createdBy?: number;
  fromEmployee?: boolean;
  remark?: string | null;
}

/**
 * Extend the user's validity by the plan's days, starting from the later of
 * today or the current expiry, and record the recharge (one transaction).
 */
export async function recharge(userId: number, plan: MasterValueRow, details: RechargeDetails = {}): Promise<RechargeRow> {
  return tx(async (db) => {
    // Row lock so two simultaneous recharges both extend the validity
    const user = await one<Pick<UserRow, 'u_id' | 'u_valid_till' | 'u_incoming_valid_till'>>(
      'SELECT u_id, u_valid_till, u_incoming_valid_till FROM js_user WHERE u_id = $1 FOR UPDATE', [userId], db);
    if (!user) throw new Error(`User ${userId} not found`);
    const type = parseInt(String(plan.mv_value1 ?? '0'), 10);
    const amount = Number(plan.mv_value_decimal);
    const start = dayStart();
    const current = type === 1 ? Number(user.u_incoming_valid_till) : Number(user.u_valid_till);
    const validTill = Math.max(start, current) + 86400 * parseInt(String(plan.mv_value || '0'), 10);
    const t = now();

    const row = await insert<RechargeRow>('js_user_recharge', {
      ur_year: config.site.fYear,
      ur_user_id: userId,
      ur_valid_till: validTill,
      ur_recharge_type: type,
      ur_plan_id: plan.mv_id,
      ur_amount: amount,
      ur_gst_amount: gstOf(amount),
      ur_received_amount: details.received ?? 0,
      ur_generate_invoice: details.invoice ?? 1,
      ur_payment_source: details.source ?? 0,
      ur_payment_log_id: details.paymentLogId ?? 0,
      ur_payment_ref_no: details.refNo ?? null,
      ur_remark: details.remark ?? null,
      ur_status: details.status ?? 1,
      ur_created_by: details.createdBy ?? userId,
      ur_created_from: details.fromEmployee ? 2 : 1,
      ur_created_on: t,
    }, '*', db);

    if (type === 1) {
      await exec('UPDATE js_user SET u_last_recharge = $2, u_incoming_valid_till = $3 WHERE u_id = $1', [userId, t, validTill], db);
    } else {
      await exec('UPDATE js_user SET u_wa_plan_status = 1, u_last_recharge = $2, u_valid_till = $3, u_active_plan = $4 WHERE u_id = $1', [userId, t, validTill, plan.mv_id], db);
    }
    return row;
  });
}

/** Mark WhatsApp users whose validity ended as expired (cron/user_status.php). */
export async function expirePlans(): Promise<number> {
  return exec(
    `UPDATE js_user SET u_wa_plan_status = 2
      WHERE u_dstatus = 0 AND u_status = 1 AND u_wa_plan_status = 1 AND u_type = $1 AND u_valid_till < $2`,
    [USER_TYPE.WHATSAPP, now() - 86398],
  );
}
