import "server-only";
import { randomInt } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { istParts, now } from "@/lib/config";
import { hashPassword } from "@/lib/password";
import { assignedUserFilter, type Admin } from "./guard";
import { F_YEAR, MV_TYPE } from "./constants";

/** Port of User::fun_generate_key(): random A-Z0-9 (or digits only). */
export function generateKey(length = 5, digitsOnly = false): string {
  const alphabet = (digitsOnly ? "" : "ABCDEFGHIJKLMNOPQRSTUVWXYZ") + "0123456789";
  return Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join("");
}

export const userTypeName = async (ut: number) =>
  (await db.js_master_value.findUnique({ where: { mv_id: BigInt(ut) }, select: { mv_name: true } }))?.mv_name ?? "Users";

/** A user the admin may see (non-super admins: only users assigned to them). */
export function findUserFor(admin: Admin, id: number, ut?: number) {
  return db.js_user.findFirst({
    where: { u_id: id, u_dstatus: 0, ...(ut ? { u_type: ut } : {}), ...assignedUserFilter(admin) },
  });
}

/** Company/GST/state come from the parent (corporate) user for WhatsApp sub-users. */
export async function companyDetails(user: { u_parent_id: number; u_company_name: string | null; u_company_gst_no: string | null; u_state: number }) {
  if (user.u_parent_id > 0) {
    const p = await db.js_user.findUnique({
      where: { u_id: user.u_parent_id },
      select: { u_company_name: true, u_company_gst_no: true, u_state: true },
    });
    return { company: p?.u_company_name ?? "", gst: p?.u_company_gst_no ?? "", state: p?.u_state ?? 0 };
  }
  return { company: user.u_company_name ?? "", gst: user.u_company_gst_no ?? "", state: user.u_state };
}

export async function masterName(id: number | bigint | null | undefined) {
  if (!id) return "";
  return (await db.js_master_value.findUnique({ where: { mv_id: BigInt(id) }, select: { mv_name: true } }))?.mv_name ?? "";
}

export const masterList = (type: number, extra: Prisma.js_master_valueWhereInput = {}, orderBy: Prisma.js_master_valueOrderByWithRelationInput[] = [{ mv_name: "asc" }]) =>
  db.js_master_value.findMany({ where: { mv_type: type, mv_dstatus: 0, ...extra }, orderBy, select: { mv_id: true, mv_name: true } });

/** Corporate users for the "Company Name" dropdown (User::fun_list with u_type = 1). */
export const companyList = (admin?: Admin) =>
  db.js_user.findMany({
    where: { u_type: 1, u_dstatus: 0, ...(admin ? assignedUserFilter(admin) : {}) },
    orderBy: { u_name: "asc" },
    select: { u_id: true, u_name: true, u_company_name: true },
  });

/** WhatsApp users dropdown for report filters. */
export const waUserList = (admin: Admin) =>
  db.js_user.findMany({
    where: { u_type: 2, u_dstatus: 0, ...assignedUserFilter(admin) },
    orderBy: { u_name: "asc" },
    select: { u_id: true, u_name: true, u_username: true },
  });

export const employeeList = () =>
  db.js_employee.findMany({ where: { emp_dstatus: 0, emp_is_left: 0 }, orderBy: { emp_name: "asc" }, select: { emp_id: true, emp_name: true } });

// ------------------------------------------------------------------ save (User::fun_add)

export type UserForm = Record<string, string | undefined>;

const yes = (v: string | undefined) => (v === "1" ? 1 : 2);
const num = (v: string | undefined) => (v && /^-?\d+$/.test(v.trim()) ? Number(v) : 0);
const txt = (v: string | undefined) => (v ?? "").trim();

/**
 * Creates or updates a js_user row. Returns an error message, or the user id.
 * Differences from PHP: values are stored as typed, without the &#39; escaping
 * (Prisma parameterises queries), and passwords are bcrypt hashed.
 */
export async function saveUser(admin: Admin, type: number, id: number | undefined, f: UserForm, password: string): Promise<string | number> {
  if (id) {
    const existing = await findUserFor(admin, id, type);
    if (!existing) return "User not found";
  }
  const username = txt(f.username);
  if (username) {
    const dup = await db.js_user.count({ where: { u_username: username, u_dstatus: 0, ...(id ? { u_id: { not: id } } : {}) } });
    if (dup > 0) return "Username Already exists";
  }

  const data: Prisma.js_userUncheckedUpdateInput = {
    u_name: txt(f.name),
    u_status: yes(f.status),
    u_username: username || null,
    u_assign_to: num(f.assign_to),
    u_updated_on: now(),
    u_updated_by: admin.empId,
  };

  if (type === 1) {
    Object.assign(data, {
      u_company_name: txt(f.company_name),
      u_company_gst_no: txt(f.company_gst_no),
      u_country: num(f.country) || 4,
      u_state: num(f.state),
      u_email_id: txt(f.email_id),
      u_billing_email_id: txt(f.billing_email_id),
      u_mobile_no: txt(f.mobile_no),
      u_balance: num(f.balance),
      u_google_sheet: yes(f.google_sheet),
      u_google_sheet_email: f.google_sheet === "1" ? txt(f.google_sheet_email) || null : null,
      u_own_account: yes(f.own_account),
    });
  } else {
    const parentId = num(f.parent_id);
    const parent = parentId ? await db.js_user.findUnique({ where: { u_id: parentId }, select: { u_own_account: true } }) : null;
    const incomingUrl = txt(f.wa_incoming_url);
    Object.assign(data, {
      u_parent_id: parentId,
      u_own_account: parent?.u_own_account ?? 2,
      u_send_wa: yes(f.send_wa),
      u_enable_ai: yes(f.enable_ai),
      u_send_app: yes(f.send_app),
      u_is_new_no: yes(f.is_new_no),
      u_wa_enable_catalogue: yes(f.wa_enable_catalogue),
      u_wa_catalogue_url: f.wa_enable_catalogue === "1" ? txt(f.wa_catalogue_url) : "",
      u_daily_limit: num(f.daily_limit),
      u_msg_limit: num(f.msg_limit),
      u_wa_no: txt(f.wa_no),
      u_wa_phone_id: txt(f.wa_phone_id),
      u_wa_b_id: txt(f.wa_b_id),
      u_business_id: txt(f.business_id),
      // PHP posted a hidden wa_enable_incoming=1, so incoming was always enabled.
      u_wa_enable_incoming: 1,
      u_wa_incoming_url: incomingUrl,
      u_wa_form_url: f.send_wa === "1" ? txt(f.wa_form_url) : undefined,
      u_ai_key: f.enable_ai === "1" ? txt(f.ai_key) : undefined,
      u_wa_app_url: f.send_app === "1" ? txt(f.wa_app_url) : undefined,
    });
  }
  if (password) data.u_password = await hashPassword(password);

  if (id) {
    await db.js_user.update({ where: { u_id: id }, data });
    return id;
  }

  const created = await db.js_user.create({
    data: { ...(data as Prisma.js_userUncheckedCreateInput), u_type: type, u_created_on: now(), u_created_by: admin.empId },
  });
  const accessCode = Array.from({ length: 5 }, () => generateKey(5)).join("-");
  await db.js_user.update({
    where: { u_id: created.u_id },
    data: { u_code: `U${String(created.u_id).padStart(5, "0")}`, u_access_code: accessCode },
  });
  return created.u_id;
}

// ------------------------------------------------------------------ recharge (User::fun_recharge)

export async function rechargeUser(
  admin: Admin,
  userId: number,
  p: { planId: number; generateInvoice: boolean; paymentReceived: boolean; paymentSource: number; paymentRefNo: string; paymentAmount: number },
): Promise<string> {
  const user = await findUserFor(admin, userId);
  if (!user) return "User not found";
  const plan = await db.js_master_value.findFirst({ where: { mv_id: BigInt(p.planId), mv_type: MV_TYPE.Plans } });
  if (!plan) return "Please select a plan";

  const amount = Number(plan.mv_value_decimal);
  const validity = Number(plan.mv_value) || 0;
  const planType = Number(plan.mv_value1);
  let start = istParts().startOfDay;
  // Extend from the current expiry when the plan is still running.
  // (PHP only applied the incoming-plan branch when a payment source was empty — a bug.)
  if ((planType === 2 || planType === 3) && user.u_valid_till > start) start = user.u_valid_till;
  if (planType === 1 && user.u_incoming_valid_till > start) start = user.u_incoming_valid_till;
  const validTill = start + 86400 * validity;

  await db.$transaction([
    db.js_user_recharge.create({
      data: {
        ur_year: F_YEAR,
        ur_user_id: userId,
        ur_valid_till: validTill,
        ur_recharge_type: planType,
        ur_plan_id: p.planId,
        ur_amount: amount,
        ur_received_amount: p.paymentAmount,
        ur_generate_invoice: p.generateInvoice ? 1 : 2,
        ur_gst_amount: Math.round(amount * 18) / 100,
        ur_payment_source: p.paymentReceived ? p.paymentSource : 0,
        ur_payment_log_id: 0,
        ur_payment_ref_no: p.paymentRefNo,
        ur_status: p.paymentReceived ? 1 : 2,
        ur_created_by: admin.empId,
        ur_created_from: 2,
        ur_created_on: now(),
      },
    }),
    planType === 1
      ? db.js_user.update({ where: { u_id: userId }, data: { u_last_recharge: now(), u_incoming_valid_till: validTill } })
      : db.js_user.update({ where: { u_id: userId }, data: { u_wa_plan_status: 1, u_last_recharge: now(), u_valid_till: validTill, u_active_plan: p.planId } }),
  ]);
  return "Recharge Sucessully Done";
}
