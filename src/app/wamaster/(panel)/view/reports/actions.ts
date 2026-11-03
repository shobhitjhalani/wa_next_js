"use server";
import { redirect } from "next/navigation";
import { getAdmin } from "@/lib/admin/guard";
import { applyBulkAction, REPORTS, type ReportKey } from "@/lib/admin/messages";

/** "Change" button under the report tables (change_status POST in the PHP pages). */
export async function bulkMessageAction(form: FormData) {
  const key = String(form.get("report")) as ReportKey;
  if (!(key in REPORTS)) redirect("/wamaster/dashboard");
  const admin = await getAdmin({ superAdmin: REPORTS[key].superOnly });
  const ids = form
    .getAll("mids[]")
    .map(String)
    .filter((v) => /^\d+$/.test(v))
    .map((v) => BigInt(v));
  const done = await applyBulkAction(admin, key, String(form.get("cstatus") ?? ""), ids);
  const back = String(form.get("back") ?? "");
  const url = back.startsWith(`/wamaster/view/reports/${key}`) ? back : `/wamaster/view/reports/${key}`;
  redirect(`${url}${url.includes("?") ? "&" : "?"}updated=${done}`);
}
