import { withMonthDefault } from "@/lib/admin/params";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { getAdmin } from "@/lib/admin/guard";
import { todayDmy, ucfirst } from "@/lib/admin/format";
import { templateSummary } from "@/lib/admin/templates";

export const dynamic = "force-dynamic";

// Backend::fun_download_wa_template_summary() as .xlsx
export async function GET(req: Request) {
  await getAdmin({ superAdmin: true });
  const sp = withMonthDefault(Object.fromEntries(new URL(req.url).searchParams.entries()));
  const { headings, rows } = await templateSummary({}, sp);
  const users = await db.js_user.findMany({ where: { u_id: { in: rows.map((r) => r.userId) } }, select: { u_id: true, u_name: true } });
  const names = new Map(users.map((u) => [u.u_id, u.u_name ?? ""]));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Template Summary");
  ws.addRow(["S. No.", "User", "Template Name", ...headings.map((h) => (h === "" ? "Not Send" : ucfirst(h))), "Total"]).font = { bold: true };
  rows.forEach((r, i) => {
    const counts = headings.map((h) => r.counts[h] ?? 0);
    const total = headings.reduce((a, h) => a + (["Que", "Incoming", "failed", "Error", "In Process"].includes(h) ? 0 : r.counts[h] ?? 0), 0);
    ws.addRow([i + 1, names.get(r.userId) ?? r.userId, r.template, ...counts, total]);
  });
  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename=wa_template_summary_${todayDmy().replace(/-/g, "_")}.xlsx`,
      "cache-control": "no-store",
    },
  });
}
