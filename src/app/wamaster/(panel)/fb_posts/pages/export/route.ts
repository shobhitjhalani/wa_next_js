import ExcelJS from 'exceljs';
import { getAccess } from '@/lib/admin-access';
import { query } from '@/lib/db';
import { phpDate } from '@/lib/time';

/**
 * GET /wamaster/fb_posts/pages/export[?tag=…] — the connected Facebook Pages as Excel (name, Page ID, client, tags),
 * to fill the `page` column of a posts CSV. No tokens. The Page ID column is text so Excel keeps every digit.
 */
export async function GET(req: Request) {
  if (!(await getAccess()).can('fb_posts')) return new Response('Forbidden', { status: 403 });
  const tag = (new URL(req.url).searchParams.get('tag') ?? '').trim();
  const rows = await query<{ fp_page_id: string; fp_name: string; fp_tags: string[]; fp_status: number; client: string | null; posted: number }>(
    `SELECT f.fp_page_id, f.fp_name, f.fp_tags, f.fp_status, NULLIF(COALESCE(NULLIF(u.u_company_name, ''), u.u_name), '') AS client,
            (SELECT COUNT(*) FROM js_fb_post p WHERE p.po_page_id = f.fp_id AND p.po_status = 3)::int AS posted
       FROM js_fb_page f LEFT JOIN js_user u ON u.u_id = f.fp_user_id
      WHERE $1 = '' OR ($1 = '-' AND cardinality(f.fp_tags) = 0) OR EXISTS (SELECT 1 FROM unnest(f.fp_tags) t WHERE lower(t) = lower($1))
      ORDER BY lower(f.fp_name)`, [tag]);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Facebook Pages');
  ws.columns = [
    { header: 'Page Name', key: 'name', width: 36 },
    { header: 'Page ID', key: 'id', width: 20, style: { numFmt: '@' } },
    { header: 'Client', key: 'client', width: 30 },
    { header: 'Tags', key: 'tags', width: 30 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Posts published', key: 'posted', width: 16 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of rows) {
    ws.addRow({ name: r.fp_name, id: r.fp_page_id, client: r.client ?? '', tags: r.fp_tags.join('; '), status: Number(r.fp_status) === 2 ? 'Problem' : 'Working', posted: r.posted });
  }
  const help = wb.addWorksheet('How to use');
  help.getColumn(1).width = 110;
  [
    'In the posts CSV, add a column "page" and write in each row where that post goes:',
    '• a Page Name or a Page ID from the first sheet (only that Page),',
    '• a tag (every Page with that tag),',
    '• several of them separated by ;  e.g.  Tata Motors Jaipur; Tata Motors Udaipur',
    '• or leave it empty: the post goes to the Pages ticked on the upload form.',
    'Tip: copy the Page Name, or format the CSV column as Text before pasting Page IDs, so Excel does not shorten them.',
  ].forEach((t) => help.addRow([t]));

  const body = await wb.xlsx.writeBuffer();
  return new Response(body as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="facebook-pages-${phpDate('Y-m-d')}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
