"use server";
// Form actions for /wamaster/view/user/* (replaces view/user/status.php GET links,
// which changed data on a plain GET and could be triggered cross-site).
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { now } from "@/lib/config";
import { getAdmin } from "@/lib/admin/guard";
import { hasRight } from "@/lib/admin/rights";
import { findUserFor, generateKey, rechargeUser, saveUser } from "@/lib/admin/users";
import { callMeta, MetaApi } from "@/lib/wa/meta-api";

const n = (f: FormData, k: string) => Number(f.get(k) ?? 0) || 0;
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function formFields(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    const m = k.match(/^data\[(\w+)\]$/);
    if (m && typeof v === "string") out[m[1]] = v;
  }
  return out;
}

export async function saveUserAction(_prev: string, form: FormData): Promise<string> {
  const admin = await getAdmin();
  const ut = n(form, "ut");
  const id = n(form, "id") || undefined;
  if (!(await hasRight(admin, "user", id ? "Edit" : "Add"))) return "You do not have rights for this action";
  const fields = formFields(form);
  if (!fields.name) return "Please enter name";
  const result = await saveUser(admin, ut, id, fields, String(form.get("txtpassword") ?? ""));
  if (typeof result === "string") return result;
  redirect(`/wamaster/view/user/view?ut=${ut}&id=${result}&wh=1`);
}

export async function setUserStatusAction(form: FormData) {
  const admin = await getAdmin();
  const id = n(form, "id");
  const status = n(form, "status") === 1 ? 1 : 2;
  if ((await findUserFor(admin, id)) && (await hasRight(admin, "user", "Edit"))) {
    await db.js_user.update({ where: { u_id: id }, data: { u_status: status, u_updated_on: now(), u_updated_by: admin.empId } });
  }
  redirect(s(form, "back") || `/wamaster/view/user?ut=${n(form, "ut")}`);
}

export async function deleteUserAction(form: FormData) {
  const admin = await getAdmin();
  const id = n(form, "id");
  if ((await findUserFor(admin, id)) && (await hasRight(admin, "user", "Delete"))) {
    await db.js_user.update({ where: { u_id: id }, data: { u_dstatus: 1, u_updated_on: now(), u_updated_by: admin.empId } });
  }
  redirect(`/wamaster/view/user?ut=${n(form, "ut")}`);
}

export async function rechargeAction(_prev: string, form: FormData): Promise<string> {
  const admin = await getAdmin();
  const userId = n(form, "user_id");
  const msg = await rechargeUser(admin, userId, {
    planId: n(form, "data[order_id]"),
    generateInvoice: s(form, "data[generate_invoice]") === "1",
    paymentReceived: s(form, "data[payment_status]") === "1",
    paymentSource: n(form, "data[payment_source]"),
    paymentRefNo: s(form, "data[payment_ref_no]"),
    paymentAmount: Number(s(form, "data[payment_amount]")) || 0,
  });
  if (msg !== "Recharge Sucessully Done") return msg;
  redirect(`/wamaster/view/user/view?ut=${n(form, "ut") || 2}&id=${userId}&recharged=1`);
}

/** Refresh User: register the number with Meta and subscribe the WABA (fun_register_wa_no). */
export async function registerWaAction(form: FormData) {
  const admin = await getAdmin();
  const user = await findUserFor(admin, n(form, "id"));
  if (user) {
    await callMeta(MetaApi.Register, user, { messaging_product: "whatsapp", pin: "010125" });
    await callMeta(MetaApi.SubscribeWaba, user, {});
  }
  redirect(`/wamaster/view/user/view?ut=${n(form, "ut") || 2}&id=${n(form, "id")}`);
}

// ------------------------------------------------------------------ Google sheet accounts

export async function saveGmailAction(_prev: string, form: FormData): Promise<string> {
  const admin = await getAdmin();
  const userId = n(form, "id");
  if (!(await findUserFor(admin, userId))) return "User not found";
  const email = s(form, "data[email_id]");
  if (!email) return "Please enter email";
  if ((await db.js_user_emails.count({ where: { ue_email_id: email, ue_dstatus: 0 } })) > 0) return "Email ID Already exists";
  await db.js_user_emails.create({
    data: {
      ue_user_id: userId,
      ue_email_id: email,
      ue_status: s(form, "data[status]") === "1" ? 1 : 2,
      ue_sheet_limit: n(form, "data[sheet_limit]"),
      ue_created_on: now(),
      ue_created_by: admin.empId,
    },
  });
  redirect(`/wamaster/view/user/view?ut=${n(form, "ut") || 1}&id=${userId}`);
}

/** kind: email | sheet | key; op: status | delete | logout */
export async function googleItemAction(form: FormData) {
  const admin = await getAdmin();
  const userId = n(form, "uid");
  const id = n(form, "item");
  const status = n(form, "status") === 1 ? 1 : 2;
  const kind = s(form, "kind");
  const op = s(form, "op");
  if (await findUserFor(admin, userId)) {
    if (kind === "email") {
      if (op === "delete") await db.js_user_emails.deleteMany({ where: { ue_id: id, ue_user_id: userId } });
      else await db.js_user_emails.updateMany({ where: { ue_id: id, ue_user_id: userId }, data: { ue_status: status } });
    } else if (kind === "sheet") {
      if (op === "delete") await db.js_user_active_sheets.updateMany({ where: { us_id: id, us_user_id: userId }, data: { us_status: 2, us_dstatus: 1 } });
      else await db.js_user_active_sheets.updateMany({ where: { us_id: id, us_user_id: userId }, data: { us_status: status } });
    } else if (kind === "key") {
      if (op === "delete") await db.js_user_data_extractor_keys.updateMany({ where: { dek_id: id, dek_user_id: userId }, data: { dek_dstatus: 1 } });
      else if (op === "logout") await db.js_user_data_extractor_keys.updateMany({ where: { dek_id: id, dek_user_id: userId }, data: { dek_is_login: 0, dek_last_login: 0 } });
    }
  }
  revalidatePath("/wamaster/view/user/view");
  redirect(`/wamaster/view/user/view?ut=${n(form, "ut") || 1}&id=${userId}`);
}

export async function generateExtractorKeyAction(form: FormData) {
  const admin = await getAdmin();
  const userId = n(form, "id");
  if (await findUserFor(admin, userId)) {
    await db.js_user_data_extractor_keys.create({
      data: {
        dek_user_id: userId,
        dek_key: Array.from({ length: 5 }, () => generateKey(5)).join("-"),
        dek_valid_till: now() + 365 * 86400,
        dek_created_on: now(),
        dek_created_by: admin.empId,
      },
    });
  }
  redirect(`/wamaster/view/user/view?ut=${n(form, "ut") || 1}&id=${userId}`);
}
