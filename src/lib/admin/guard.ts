import "server-only";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { SUPER_ADMIN_TYPE } from "@/lib/session";

export type Admin = { empId: number; name: string; mType: number; isSuper: boolean };

/**
 * Signed-in admin for /wamaster pages. Unlike the PHP session check, it also
 * re-checks that the employee is still active (not deleted / left / disabled).
 */
export async function getAdmin(opts: { superAdmin?: boolean } = {}): Promise<Admin> {
  const session = await requireAdmin();
  const emp = await db.js_employee.findFirst({
    where: { emp_id: session.empId, emp_dstatus: 0, emp_is_left: 0, emp_status: 1 },
    select: { emp_id: true, emp_name: true, emp_m_type: true },
  });
  if (!emp) redirect("/wamaster/logout");
  const admin = {
    empId: emp.emp_id,
    name: emp.emp_name ?? "",
    mType: emp.emp_m_type,
    isSuper: emp.emp_m_type === SUPER_ADMIN_TYPE,
  };
  // fun_check_admin(): super-admin-only pages send everyone else to the dashboard.
  if (opts.superAdmin && !admin.isSuper) redirect("/wamaster/dashboard");
  return admin;
}

/** Non-super admins only see users assigned to them (PHP: u_assign_to = $_SESSION['u_id']). */
export const assignedUserFilter = (admin: Admin) => (admin.isSuper ? {} : { u_assign_to: admin.empId });

/** Same restriction for queries on js_message (joins js_user only when needed). */
export const assignedMessageFilter = (admin: Admin) => (admin.isSuper ? {} : { js_user: { u_assign_to: admin.empId } });
