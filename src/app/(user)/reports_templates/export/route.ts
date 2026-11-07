import { NextResponse, type NextRequest } from 'next/server';
import { getUser } from '@/lib/auth';
import { csvFromRows } from '@/lib/http';
import { phpDate } from '@/lib/time';
import { campaignSummary, readSummaryFilter, STATUS_COLUMNS } from '@/lib/services/campaign-summary';

/** GET /reports_templates/export — the Campaign Summary as CSV. */
export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL('/', req.url));

  const { rows, totals } = await campaignSummary({ userId: user.u_id },readSummaryFilter(req.nextUrl.searchParams));
  const cell = (n: number | undefined) => (n === undefined ? '' : n);
  return csvFromRows(
    `campaign-summary-${phpDate('Y-m-d')}.csv`,
    ['Date', 'Campaign Name', 'Template', ...STATUS_COLUMNS.map(([, label]) => label), 'Total', 'Total Data'],
    [
      ...rows.map((r) => [
        phpDate('d-m-Y H:i', r.date), r.name, r.template,
        ...STATUS_COLUMNS.map(([key]) => cell(r.counts?.[key])),
        cell(r.counts?.total), r.counts ? r.counts.all : r.recipients,
      ]),
      ['Total', '', '', ...STATUS_COLUMNS.map(([key]) => totals[key]), totals.total, totals.all],
    ],
  );
}
