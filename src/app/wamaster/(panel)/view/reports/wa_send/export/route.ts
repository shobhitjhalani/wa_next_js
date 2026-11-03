import { withMonthDefault } from "@/lib/admin/params";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { getAdmin } from "@/lib/admin/guard";
import { phpDate, todayDmy } from "@/lib/admin/format";
import { WA_STATUS } from "@/lib/admin/constants";
import { messageError, messageSummary, REPORT_SELECT, reportWhere } from "@/lib/admin/messages";

export const dynamic = "force-dynamic";
const MAX_ROWS = 100_000;

// Backend::fun_download_wa_send_report() — same columns, as a real .xlsx file.
export async function GET(req: Request) {
  const admin = await getAdmin({ superAdmin: true });
  const sp = withMonthDefault(Object.fromEntries(new URL(req.url).searchParams.entries()));
  const where = reportWhere("wa_send", admin, sp);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("WA Report");
  ws.addRow(["S. No.", "Username", "Date", "Mobile No", "Content", "Updated On", "WA Status", "Status"]).font = { bold: true };

  // Page through by id so memory stays flat on large exports.
  let cursor: bigint | undefined;
  let n = 0;
  while (n < MAX_ROWS) {
    const rows = await db.js_message.findMany({
      where: cursor ? { AND: [where, { m_id: { lt: cursor } }] } : where,
      orderBy: { m_id: "desc" },
      take: 5000,
      select: REPORT_SELECT,
    });
    if (rows.length === 0) break;
    for (const m of rows) {
      ws.addRow([
        ++n,
        m.js_user.u_username,
        phpDate("d M H:i:s", m.m_created_on),
        m.m_mobile_no,
        messageSummary(m).slice(0, 100),
        phpDate("d-M-Y H:i:s", m.m_updated_on),
        m.m_status !== 3 ? WA_STATUS[m.m_status] : m.m_delivery_status || m.m_message_id,
        m.m_delivery_status === "failed" ? messageError(m) : WA_STATUS[m.m_status],
      ]);
    }
    cursor = rows[rows.length - 1].m_id;
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename=wa_send_report_${todayDmy().replace(/-/g, "_")}.xlsx`,
      "cache-control": "no-store",
    },
  });
}
