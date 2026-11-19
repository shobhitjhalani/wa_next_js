import ExcelJS from 'exceljs';
import { teamAccount } from '@/lib/auth';
import { redirectTo } from '@/lib/redirect';

/** GET /compose/sample — sample .xlsx for Audience → Excel Upload (Mobile + Name; the mobile column is text so Excel keeps every digit). */
export async function GET() {
  if (!(await teamAccount((p) => p.campaignCreate))) return redirectTo('/');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Contacts');
  ws.columns = [
    { header: 'Mobile', key: 'mobile', width: 18, style: { numFmt: '@' } },
    { header: 'Name', key: 'name', width: 24 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const [mobile, name] of [['9876543210', 'Ravi Kumar'], ['919812345678', 'Priya Sharma'], ['+971501234567', 'Ahmed']]) ws.addRow({ mobile, name });
  const body = await wb.xlsx.writeBuffer();
  return new Response(body as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="audience-sample.xlsx"',
      'Cache-Control': 'no-store',
    },
  });
}
