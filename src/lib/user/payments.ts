import "server-only";
import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { now } from "@/lib/config";
import { phpDate, startOfTodayIst } from "./format";

// wa_plans.php -> fun_payment_log_add() -> paycca.php -> CCAvenue -> success.php.
// Payment state is kept in log.js_payment_log (the PHP used session variables).

const PLAN_TYPE = 82; // js_master_value.mv_type of WhatsApp plans
const IV = Buffer.from([...Array(16).keys()]);

/** js_payment_log.p_gateway value for CCAvenue, the only gateway in use. */
const GATEWAY_CCAVENUE = 2;

export function waPlans() {
  return db.js_master_value.findMany({
    where: { mv_value_decimal: { gt: 0 }, mv_type: PLAN_TYPE, mv_value1: "2", mv_status: 1, mv_dstatus: 0 },
    orderBy: { mv_display_order: "asc" },
  });
}

export async function previousBalance(parentId: number) {
  if (!(parentId > 0)) return 0;
  const p = await db.js_user.findUnique({ where: { u_id: parentId }, select: { u_balance: true } });
  return p?.u_balance ?? 0;
}

/** Creates the pending payment log for a plan; returns its id (or null for an invalid plan). */
export async function createPaymentLog(user: { u_id: number; u_parent_id: number; u_name: string | null; u_mobile_no: string | null; u_email_id: string | null }, planId: number) {
  const plan = await db.js_master_value.findFirst({ where: { mv_id: planId, mv_type: PLAN_TYPE } });
  const amount = Number(plan?.mv_value_decimal ?? 0);
  if (!plan || !(amount > 0)) return null;
  const payable = Math.round((amount + (amount * 18) / 100) * 100) / 100 + (await previousBalance(user.u_parent_id));
  const h = await headers();
  const log = await db.log_js_payment_log.create({
    data: {
      p_gateway: GATEWAY_CCAVENUE,
      p_no: "PL-pending",
      p_user_id: user.u_id,
      p_user_name: user.u_name,
      p_user_mobile: (user.u_mobile_no ?? "").slice(0, 10),
      p_user_email: user.u_email_id,
      p_status: 1,
      p_amount: Math.round(payable), // column is an integer, as in MySQL
      p_order_no: String(planId),
      p_ip_address: (h.get("x-forwarded-for")?.split(",")[0] ?? "").trim().slice(0, 25),
    },
  });
  const pno = `PL-${phpDate("ymd", now())}-${log.p_id}`;
  await db.log_js_payment_log.update({ where: { p_id: log.p_id }, data: { p_no: pno } });
  return { id: log.p_id, pno, payable };
}

export function pendingPayment(userId: number, id: number) {
  return db.log_js_payment_log.findFirst({ where: { p_id: id, p_user_id: userId, p_status: 1 } });
}

// ---- CCAvenue (Crypto.php): AES-128-CBC, key = md5(working key), fixed IV 0..15, hex.

const ccaKey = () => createHash("md5").update(process.env.CCA_WORKING_KEY ?? "").digest();

export function ccaEncrypt(plain: string) {
  const c = createCipheriv("aes-128-cbc", ccaKey(), IV);
  return Buffer.concat([c.update(plain, "utf8"), c.final()]).toString("hex");
}

export function ccaDecrypt(hex: string) {
  const d = createDecipheriv("aes-128-cbc", ccaKey(), IV);
  return Buffer.concat([d.update(Buffer.from(hex, "hex")), d.final()]).toString("utf8");
}

export function ccaRequest(p: { pno: string; amount: number }, user: { u_name: string | null; u_mobile_no: string | null; u_email_id: string | null }, siteUrl: string) {
  const data: Record<string, string> = {
    merchant_id: process.env.CCA_MERCHANT_MID ?? "",
    language: "EN",
    amount: String(p.amount),
    currency: "INR",
    redirect_url: `${siteUrl}payment/ccavenue`,
    cancel_url: `${siteUrl}payment/ccavenue`,
    billing_name: user.u_name ?? "",
    billing_address: "", billing_state: "", billing_city: "", billing_zip: "",
    billing_country: "India",
    billing_tel: user.u_mobile_no ?? "",
    billing_email: user.u_email_id ?? "",
    order_id: p.pno,
  };
  const merchantData = Object.entries(data).map(([k, v]) => `${k}=${v}&`).join("");
  return { encRequest: ccaEncrypt(merchantData), accessCode: process.env.CCA_ACCESS_CODE ?? "" };
}

/**
 * Handles CCAvenue's encrypted response. Changes vs PHP: only "Success" counts
 * (PHP also accepted "Initiated"), the paid amount must match the log, a log is
 * credited once, and the plan comes from the log (PHP passed the order number
 * as the plan id, so the validity was never extended).
 */
export async function completeCcavenue(encResp: string): Promise<{ paymentId?: number; ok: boolean }> {
  let fields: Record<string, string>;
  try {
    fields = Object.fromEntries(ccaDecrypt(encResp).split("&").map((kv) => kv.split("=")).map(([k, v]) => [k, v ?? ""]));
  } catch {
    return { ok: false };
  }
  const log = await db.log_js_payment_log.findFirst({ where: { p_no: fields.order_id ?? "" } });
  if (!log) return { ok: false };
  const paidOk = fields.order_status === "Success" && Math.round(Number(fields.amount)) === log.p_amount;
  if (log.p_status !== 1) return { paymentId: log.p_id, ok: log.p_status === 2 };
  if (!paidOk) {
    await db.log_js_payment_log.update({ where: { p_id: log.p_id }, data: { p_status: 3, p_reference_no: fields.tracking_id ?? "" } });
    return { paymentId: log.p_id, ok: false };
  }
  await db.log_js_payment_log.update({
    where: { p_id: log.p_id },
    data: { p_status: 2, p_reference_no: fields.bank_ref_no ?? "", p_payment_id: fields.tracking_id ?? "", p_payment_mode: (fields.payment_mode ?? "").slice(0, 100) },
  });
  await applyPlan(log.p_user_id, Number(log.p_order_no), { amountPaid: Number(fields.amount), logId: log.p_id, ref: fields.bank_ref_no ?? "" });
  return { paymentId: log.p_id, ok: true };
}

/** Frontend::fun_updated_user_plan(): recharge row + extend the user's validity. */
export async function applyPlan(userId: number, planId: number, pay: { amountPaid: number; logId: number; ref: string }) {
  const plan = await db.js_master_value.findUnique({ where: { mv_id: planId } });
  const user = await db.js_user.findUnique({ where: { u_id: userId } });
  if (!plan || !user) return null;
  const amount = Number(plan.mv_value_decimal);
  const validity = Number(plan.mv_value) || 0;
  const planType = Number(plan.mv_value1);
  let from = startOfTodayIst();
  if (planType === 2 && user.u_valid_till > from) from = user.u_valid_till;
  if (planType === 1 && user.u_incoming_valid_till > from) from = user.u_incoming_valid_till;
  const validTill = from + 86400 * validity;
  await db.js_user_recharge.create({
    data: {
      ur_user_id: userId,
      ur_valid_till: validTill,
      ur_recharge_type: planType,
      ur_generate_invoice: 1,
      ur_plan_id: planId,
      ur_amount: amount,
      ur_gst_amount: Math.round(amount * 18) / 100,
      ur_received_amount: pay.amountPaid,
      ur_payment_source: 1,
      ur_payment_log_id: pay.logId,
      ur_payment_ref_no: pay.ref,
      ur_status: 1,
      ur_created_by: userId,
      ur_created_on: now(),
    },
  });
  if (planType === 2) {
    await db.js_user.update({
      where: { u_id: userId },
      data: { u_wa_plan_status: 1, u_last_recharge: now(), u_valid_till: validTill, u_active_plan: planId },
    });
  } else if (planType === 1) {
    await db.js_user.update({ where: { u_id: userId }, data: { u_last_recharge: now(), u_incoming_valid_till: validTill } });
  }
  return validTill;
}

export function rechargeHistory(userId: number) {
  return db.js_user_recharge.findMany({ where: { ur_user_id: userId, ur_dstatus: 0 }, orderBy: { ur_id: "desc" }, take: 200 });
}
