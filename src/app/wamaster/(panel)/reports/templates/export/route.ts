import { NextResponse, type NextRequest } from 'next/server';
import { getAdmin } from '@/lib/auth';
import { csvFromRows } from '@/lib/http';
import { campaignSummary, readSummaryFilter, STATUS_COLUMNS } from '@/lib/services/campaign-summary';
import { int } from '@/lib/text';
import { phpDate } from '@/lib/time';

/** GET /wamaster/reports/templates/export — the admin Campaign Summary as CSV. */
export async function GET(req: NextRequest) {
  if (!(await getAdmin())) return NextResponse.redirect(new URL('/wamaster', req.url));

  const q = req.nextUrl.searchParams;
  const scope = {
    userId: q.get('user_id')?.trim() ? int(q.get('user_id')) : null,
    parentId: q.get('parent_id')?.trim() ? int(q.get('parent_id')) : null,
  };
  const { rows, totals } = await campaignSummary(scope, readSummaryFilter(q));
  const cell = (n: number | undefined) => (n === undefined ? '' : n);
  return csvFromRows(
    `campaign-summary-all-${phpDate('Y-m-d')}.csv`,
    ['Date', 'Username', 'Campaign Name', 'Template', ...STATUS_COLUMNS.map(([, label]) => label), 'Total', 'Total Data'],
    [
      ...rows.map((r) => [
        phpDate('d-m-Y H:i', r.date), r.username, r.name, r.template,
        ...STATUS_COLUMNS.map(([key]) => cell(r.counts?.[key])),
        cell(r.counts?.total), r.counts ? r.counts.all : r.recipients,
      ]),
      ['Total', '', '', '', ...STATUS_COLUMNS.map(([key]) => totals[key]), totals.total, totals.all],
    ],
  );
}
