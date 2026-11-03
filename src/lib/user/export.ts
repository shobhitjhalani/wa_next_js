import "server-only";
import ExcelJS from "exceljs";
import { phpDate, phpJsonDecode, todayDmy } from "./format";
import { allMessages, type Filters } from "./messages";

// Frontend::fun_download_messages(): 1 = all sent, 2 = error (template), 3 = failed.
// The PHP sent an HTML table named .xls; this writes a real .xlsx with the same columns.
const KIND = { "1": "reports", "2": "error", "3": "failed" } as const;
const FILE = { "1": "messages_dump", "2": "error_messages_dump", "3": "failed_messages_dump" } as const;

export async function exportMessages(userId: number, type: "1" | "2" | "3", f: Filters) {
  const rows = await allMessages(userId, KIND[type], f);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Messages");
  ws.addRow([
    "S. No.", "Date of Created", "Name", "Mobile No", "Template Name", "Message Content",
    "Sheet ID", "Delivery Status", "Send On", "Remark",
  ]).font = { bold: true };
  rows.forEach((r, i) => {
    let remark = "";
    if (r.m_delivery_status === "failed" || type === "2") {
      const a = phpJsonDecode<{ title?: string }[]>(r.m_status_response);
      const b = phpJsonDecode<{ title?: string }[]>(r.m_error_codes);
      remark = a?.[0]?.title ?? b?.[0]?.title ?? "";
    }
    ws.addRow([
      i + 1,
      phpDate("d-m-Y H:i:s", r.m_created_on),
      type === "2" ? "" : (r.m_sender_name ?? ""),
      r.m_mobile_no ?? "",
      r.m_msg_template_name ?? "",
      r.m_content ?? "",
      r.m_sheet_id ?? "",
      r.m_delivery_status ?? "",
      phpDate("d-m-Y H:i:s", r.m_updated_on),
      remark,
    ]);
  });
  const name = `${FILE[type]}_${todayDmy().replace(/-/g, "_")}.xlsx`;
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), name };
}
