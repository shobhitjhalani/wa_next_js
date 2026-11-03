import "server-only";
import { db } from "@/lib/db";
import type { Admin } from "./guard";

/**
 * Port of Backend::fun_check_rights(): super admins can do everything; dashboard and
 * user pages are open to every admin; anything else needs a js_employee_rights row
 * "<module code>_<action id>".
 */
export async function hasRight(admin: Admin, page: string, action = "View"): Promise<boolean> {
  if (admin.isSuper) return true;
  if (["dashboard", "user", "calendar_full"].includes(page)) return true;
  if (!page || !action) return false;

  const mod = await db.js_modules.findFirst({ where: { mo_name: { equals: page, mode: "insensitive" } }, select: { mo_code: true } });
  if (!mod?.mo_code) return false;
  const act = await db.js_m_actions.findFirst({ where: { ma_name: { equals: action, mode: "insensitive" } }, select: { ma_id: true } });
  if (!act) return false;

  const n = await db.js_employee_rights.count({
    where: { er_dstatus: 0, er_emp_id: admin.empId, er_page_action: `${mod.mo_code}_${act.ma_id}` },
  });
  return n > 0;
}
