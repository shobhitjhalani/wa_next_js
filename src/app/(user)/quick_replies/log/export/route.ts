import ExcelJS from 'exceljs';
import type { NextRequest } from 'next/server';
import { getAccount } from '@/lib/auth';
import { query } from '@/lib/db';
import { phpDate } from '@/lib/time';
import { LOG_SELECT, logStatus, logWhere, readLogFilter, type LogRow } from '../filter';

const MAX_ROWS = 100_000;

/** GET /quick_replies/log/export — the Sent Log with the page's filters as an .xlsx file. */
export async function GET(req: NextRequest) {
  const account = await getAccount();
  if (!account || account.member) return new Response('Unauthenticated.', { status: 401 });
  const f = readLogFilter(req.nextUrl.searchParams);
  const args: unknown[] = [];
  const where = logWhere(account.user.u_id, f, args);
  const rows = await query<LogRow>(`${LOG_SELECT} WHERE ${where} ORDER BY l.ql_sent_on DESC, l.ql_id DESC LIMIT ${MAX_ROWS}`, args);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Quick Replies Sent');
  ws.columns = [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Time', key: 'time', width: 12 },
    { header: 'Mobile No', key: 'mobile', width: 16, style: { numFmt: '@' } },
    { header: 'Name', key: 'name', width: 24 },
    { header: 'Quick Reply', key: 'reply', width: 26 },
    { header: 'Keyword', key: 'keyword', width: 18 },
    { header: "Customer's Message", key: 'text', width: 40 },
    { header: 'Status', key: 'status', width: 14 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of rows) {
    const t = Number(r.ql_sent_on);
    ws.addRow({
      date: phpDate('d-m-Y', t), time: phpDate('h:i:s A', t), mobile: r.ql_mobile, name: r.ql_name ?? '', reply: r.ql_qr_name,
      keyword: r.ql_keyword ?? '', text: r.ql_text ?? '', status: logStatus(r),
    });
  }
  const body = await wb.xlsx.writeBuffer();
  return new Response(body as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="quick-replies-sent-${phpDate('Y-m-d')}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
