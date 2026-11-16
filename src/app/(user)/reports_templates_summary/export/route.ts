import type { NextRequest } from 'next/server';
import { getUser } from '@/lib/auth';
import { csvFromRows } from '@/lib/http';
import { redirectTo } from '@/lib/redirect';
import { campaignSummary, readSummaryFilter } from '@/lib/services/campaign-summary';
import { phpDate } from '@/lib/time';

/** GET /reports_templates_summary/export — Date, Campaign Name, Total (Send + Delivered + Read) as CSV. */
export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return redirectTo('/');
  const { rows, totals } = await campaignSummary({ userId: user.u_id }, readSummaryFilter(req.nextUrl.searchParams));
  return csvFromRows(
    `campaign-total-summary-${phpDate('Y-m-d')}.csv`,
    ['Date', 'Campaign Name', 'Total (Send + Delivered + Read)'],
    [...rows.map((r) => [phpDate('d-m-Y H:i', r.date), r.name, r.counts ? r.counts.total : '']), ['Total', '', totals.total]],
  );
}
