"use server";
// Team members (js_employee) and the signed-in admin's own password.
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { now } from "@/lib/config";
import { hashPassword, verifyPassword } from "@/lib/password";
import { getAdmin } from "./guard";
import { istDayStart } from "./format";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Backend::fun_add_employee() (photo/document uploads were unused by the form and are not ported). */
export async function saveTeamMemberAction(_prev: string, form: FormData): Promise<string> {
  const admin = await getAdmin({ superAdmin: true });
  const id = Number(form.get("id") ?? 0) || 0;
  const name = s(form, "data[name]");
  const username = s(form, "data[username]");
  if (!name) return "Please enter name";
  if (username) {
    const dup = await db.js_employee.count({ where: { emp_username: username, emp_dstatus: 0, ...(id ? { emp_id: { not: id } } : {}) } });
    if (dup > 0) return "Username Already exists";
  }
  const password = s(form, "txtpassword");
  const data = {
    emp_name: name,
    emp_email_id: s(form, "data[email_id]"),
    emp_mobile: s(form, "data[mobile]"),
    emp_username: username || null,
    emp_status: s(form, "data[status]") === "1" ? 1 : 2,
    ...(password ? { emp_password: await hashPassword(password) } : {}),
  };
  let empId = id;
  if (id) {
    await db.js_employee.update({ where: { emp_id: id }, data: { ...data, emp_updated_on: now() } });
  } else {
    const created = await db.js_employee.create({ data: { ...data, emp_created_on: now(), emp_entry_code: `${admin.empId}${now()}` } });
    empId = created.emp_id;
    await db.js_employee.update({ where: { emp_id: empId }, data: { emp_code: `E${String(empId).padStart(4, "0")}` } });
  }
  redirect(`/wamaster/view/teams/view?id=${empId}&saved=1`);
}

/** Backend::fun_left_employee(): mark a member as left and revoke access. */
export async function teamMemberLeftAction(form: FormData) {
  const admin = await getAdmin({ superAdmin: true });
  const id = Number(form.get("id") ?? 0) || 0;
  if (id && id !== admin.empId) {
    await db.js_employee.update({
      where: { emp_id: id },
      data: { emp_status: 2, emp_is_left: 1, emp_system_access: 2, emp_remark: s(form, "txtremark"), emp_updated_on: now(), emp_dol: istDayStart(s(form, "txtdol")) ?? now() },
    });
  }
  redirect("/wamaster/view/teams");
}

/** Backend::fun_change_password_employee() — now bcrypt. */
export async function changeOwnPasswordAction(_prev: string, form: FormData): Promise<string> {
  const admin = await getAdmin();
  const current = String(form.get("txtcpswrd") ?? "");
  const next = String(form.get("txtnpswrd") ?? "");
  const confirm = String(form.get("txtrpswrd") ?? next);
  if (!next || next.length < 6) return "New password must be at least 6 characters";
  if (next !== confirm) return "New password and confirm password do not match";
  const emp = await db.js_employee.findFirst({ where: { emp_id: admin.empId, emp_dstatus: 0 }, select: { emp_password: true } });
  if (!(await verifyPassword(current, emp?.emp_password ?? null)).ok) return "Invalid Password";
  await db.js_employee.update({ where: { emp_id: admin.empId }, data: { emp_password: await hashPassword(next), emp_updated_on: now() } });
  return "Password Successfully Changed";
}
