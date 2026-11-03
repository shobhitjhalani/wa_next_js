import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { now } from "@/lib/config";
import { hashPassword, verifyPassword } from "@/lib/password";
import { getAdminSession, getUserSession, SUPER_ADMIN_TYPE } from "@/lib/session";

async function clientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("client-ip") ??
    h.get("x-forwarded-for")?.split(",")[0].trim() ??
    h.get("x-real-ip") ??
    ""
  );
}

// ---------------------------------------------------------------- users (js_user)

/** Port of Frontend::fun_user_login(). Returns an error message, or redirects on success. */
export async function loginUser(username: string, password: string): Promise<string> {
  const base = {
    u_dstatus: 0,
    u_status: { in: [1, 3] },
    u_username: { equals: username, mode: "insensitive" as const },
  };
  const user = await db.js_user.findFirst({ where: base });
  if (!user) return "Username doesn't exists";

  const { ok, needsUpgrade } = await verifyPassword(password, user.u_password);
  if (!ok) return "Invalid Password";

  if (needsUpgrade) {
    await db.js_user.update({
      where: { u_id: user.u_id },
      data: { u_password: await hashPassword(password) },
    });
  }

  const session = await getUserSession();
  session.userId = user.u_id;
  session.name = user.u_name ?? "";
  session.username = (user.u_username ?? "").toLowerCase();
  session.email = (user.u_email_id ?? "").toLowerCase();
  session.mobile = user.u_mobile_no ?? "";
  session.code = user.u_code ?? "";
  session.type = Number(user.u_type);
  session.apiUrl = user.u_api_url ?? "";
  session.accessCode = user.u_access_code ?? "";

  const log = await db.log_js_user_login_log.create({
    data: { ll_sid: user.u_id, ll_s_user: user.u_name, ll_s_time: now(), ll_ip: await clientIp() },
  });
  session.loginLogId = Number(log.ll_id);
  await session.save();

  redirect("/dashboard");
}

/** Port of Frontend::logout(). */
export async function logoutUser() {
  const session = await getUserSession();
  if (session.loginLogId) {
    await db.log_js_user_login_log
      .update({ where: { ll_id: session.loginLogId }, data: { ll_e_time: now() } })
      .catch(() => undefined);
  }
  if (session.userId) {
    await db.js_user.update({ where: { u_id: session.userId }, data: { u_last_active: 0 } });
  }
  session.destroy();
}

/**
 * Port of applicationtop.php + fun_check_login(): loads the signed-in user,
 * marks an expired plan, and redirects to the login page when not signed in.
 */
export async function requireUser() {
  const session = await getUserSession();
  if (!session.userId) redirect("/");

  const user = await db.js_user.findFirst({ where: { u_id: session.userId, u_dstatus: 0 } });
  if (!user) {
    session.destroy();
    redirect("/");
  }

  if (user.u_valid_till < now() && user.u_status === 1 && user.u_wa_plan_status !== 2) {
    await db.js_user.update({ where: { u_id: user.u_id }, data: { u_wa_plan_status: 2 } });
    user.u_wa_plan_status = 2;
  }
  return user;
}

// ---------------------------------------------------------------- admins (js_employee, /wamaster)

/** Port of Login::fun_login() from wamaster. */
export async function loginAdmin(username: string, password: string): Promise<string> {
  const emp = await db.js_employee.findFirst({
    where: { emp_dstatus: 0, emp_is_left: 0, emp_status: 1, emp_username: username },
  });
  const { ok, needsUpgrade } = await verifyPassword(password, emp?.emp_password ?? null);
  if (!emp || !ok) return "Invalid Username or Password";

  await db.js_employee.update({
    where: { emp_id: emp.emp_id },
    data: {
      emp_is_login: 1,
      emp_last_active: now(),
      ...(needsUpgrade ? { emp_password: await hashPassword(password) } : {}),
    },
  });

  const session = await getAdminSession();
  session.empId = emp.emp_id;
  session.name = emp.emp_name ?? "";
  session.mType = emp.emp_m_type;

  const log = await db.log_js_employee_login_log.create({
    data: { ll_sid: emp.emp_id, ll_s_user: emp.emp_name ?? "", ll_s_time: now(), ll_ip: await clientIp() },
  });
  session.loginLogId = Number(log.ll_id);
  await session.save();

  redirect("/wamaster/dashboard");
}

export async function logoutAdmin() {
  const session = await getAdminSession();
  if (session.loginLogId) {
    await db.log_js_employee_login_log
      .update({ where: { ll_id: session.loginLogId }, data: { ll_e_time: now() } })
      .catch(() => undefined);
  }
  if (session.empId) {
    await db.js_employee.update({ where: { emp_id: session.empId }, data: { emp_is_login: 0 } });
  }
  session.destroy();
}

/** Port of fun_check_login() (and fun_check_admin() when superAdmin is set). */
export async function requireAdmin({ superAdmin = false } = {}) {
  const session = await getAdminSession();
  if (!session.empId || !session.name) redirect("/wamaster");
  if (superAdmin && session.mType !== SUPER_ADMIN_TYPE) redirect("/wamaster/dashboard");
  return session;
}
