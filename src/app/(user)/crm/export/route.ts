import type { NextRequest } from 'next/server';
import { getUser } from '@/lib/auth';
import { sourceInfo, STATUS_INFO } from '@/lib/crm';
import { csvResponse, sp } from '@/lib/http';
import { phpDate } from '@/lib/time';
import { LEAD_TABS, leadFilter } from '../leads-query';

/** GET /crm/export — the leads of the current tab / search / filters as CSV, with the latest follow-up note. */
export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return Response.json({ message: 'Unauthenticated.' }, { status: 401 });
  if (Number(user.u_crm) !== 1) return Response.json({ message: 'The Leads CRM is not enabled for this account.' }, { status: 403 });
  const params = Object.fromEntries(req.nextUrl.searchParams);
  const tab = LEAD_TABS.find((t) => t.key === sp(params, 'tab')) ?? LEAD_TABS[6];
  const { where, args } = leadFilter(user.u_id, params, tab, sp(params, 'q').slice(0, 100));
  const date = (t: number) => (t ? phpDate('d-m-Y h:i A', t) : '');
  return csvResponse(`leads-${tab.key}-${phpDate('Y-m-d')}.csv`,
    ['Name', 'Mobile', 'Email', 'Source', 'Campaign', 'Status', 'Next follow-up', 'Last follow-up', 'Latest note', 'Notes', 'Other answers', 'Received'],
    `SELECT l.*, (SELECT fu_note FROM js_crm_followup f WHERE f.fu_lead_id = l.ld_id AND f.fu_note <> '' ORDER BY f.fu_id DESC LIMIT 1) AS last_note
       FROM js_crm_lead l WHERE ${where} ORDER BY l.ld_id DESC`, args,
    (r: Record<string, any>) => [
      r.ld_name, r.ld_mobile, r.ld_email, sourceInfo(r.ld_source).label, r.ld_campaign, STATUS_INFO[r.ld_status]?.label ?? '',
      date(r.ld_next_followup), date(r.ld_last_followup), r.last_note ?? '', r.ld_notes,
      Object.entries(r.ld_fields ?? {}).map(([k, v]) => `${k}: ${v}`).join('; '), date(r.ld_created_on),
    ]);
}
