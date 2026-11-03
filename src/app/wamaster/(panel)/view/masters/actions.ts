"use server";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { now } from "@/lib/config";
import { getAdmin } from "@/lib/admin/guard";
import { hasRight } from "@/lib/admin/rights";
import { masterLayout } from "@/lib/admin/masters";

const n = (f: FormData, k: string) => Number(f.get(k) ?? 0) || 0;

/** Masters::fun_add() — generic save of a js_master_value row of type h. */
export async function saveMasterAction(_prev: string, form: FormData): Promise<string> {
  const admin = await getAdmin();
  const h = n(form, "h");
  const id = n(form, "id");
  if (!(await hasRight(admin, "masters", id ? "Edit" : "Add"))) return "You do not have rights for this action";
  const name = String(form.get("mv_name") ?? "").trim();
  if (!name) return "Please enter title";
  const dup = await db.js_master_value.count({ where: { mv_type: h, mv_dstatus: 0, mv_name: { equals: name, mode: "insensitive" }, ...(id ? { mv_id: { not: BigInt(id) } } : {}) } });
  if (dup > 0) return "Title already exists";

  const data: Prisma.js_master_valueUncheckedUpdateInput = { mv_name: name, mv_status: form.get("mv_status") === "1" ? 1 : 2, mv_updated_on: now() };
  for (const f of masterLayout(h).form) {
    if (f.field === "mv_name") continue;
    const v = String(form.get(f.field) ?? "").trim();
    if (f.field === "mv_display_order") data.mv_display_order = Number(v) || 0;
    else if (f.field === "mv_value_decimal") data.mv_value_decimal = Number(v) || 0;
    else if (f.field === "mv_value") data.mv_value = v;
    else data[f.field] = v;
  }
  if (id) await db.js_master_value.update({ where: { mv_id: BigInt(id) }, data });
  else await db.js_master_value.create({ data: { ...(data as Prisma.js_master_valueUncheckedCreateInput), mv_type: h, mv_value: (data.mv_value as string) ?? "" } });
  redirect(`/wamaster/view/masters?h=${h}&saved=1`);
}

export async function deleteMasterAction(form: FormData) {
  const admin = await getAdmin();
  const h = n(form, "h");
  if (await hasRight(admin, "masters", "Delete")) {
    await db.js_master_value.updateMany({ where: { mv_id: BigInt(n(form, "id")), mv_type: h }, data: { mv_dstatus: 1, mv_updated_on: now() } });
  }
  redirect(`/wamaster/view/masters?h=${h}`);
}
