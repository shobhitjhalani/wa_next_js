import { NextResponse, type NextRequest } from 'next/server';
import { logActivity } from '@/lib/activity';
import { getAdmin } from '@/lib/auth';
import { STATUS_INFO } from '@/lib/crm';
import { csvResponse } from '@/lib/http';
import { phpDate } from '@/lib/time';
import { LEAD_COLS, leadWhere, type LeadListRow } from '../query';

/** CSV of the Facebook Leads list with the same filters (super admin). */
export async function GET(req: NextRequest) {
  const admin = await getAdmin();
  if (!admin) return NextResponse.redirect(new URL('/wamaster', req.url));
  if (!admin.isSuperAdmin) return new NextResponse('Forbidden', { status: 403 });
  const params = Object.fromEntries(req.nextUrl.searchParams);
  const { where, args } = leadWhere(params);
  await logActivity({ module: 'exports', action: 'Exported Facebook leads', details: Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`) }, admin);
  return csvResponse<LeadListRow & Record<string, unknown>>(
    `facebook-leads-${phpDate('Y-m-d')}.csv`,
    ['Received', 'Client', 'Page', 'Page ID', 'Form', 'Campaign', 'Ad', 'Platform', 'Name', 'Mobile', 'Email', 'Status', 'Answers'],
    `SELECT ${LEAD_COLS} FROM js_crm_lead l JOIN js_user u ON u.u_id = l.ld_user_id WHERE ${where} ORDER BY l.ld_created_on DESC, l.ld_id DESC`,
    args,
    (l) => [
      phpDate('d-m-Y H:i', l.ld_created_on), l.client ?? '', l.page_name, l.ld_meta_page_id, l.ld_meta_form_name || l.ld_campaign, l.ld_meta_campaign_name,
      l.ld_meta_ad_name, l.ld_platform === 'ig' || l.ld_source === 'instagram' ? 'Instagram' : 'Facebook', l.ld_name, l.ld_mobile, l.ld_email,
      STATUS_INFO[l.ld_status]?.label ?? l.ld_status,
      Object.entries(l.ld_fields ?? {}).map(([k, v]) => `${k}: ${v}`).join(' | '),
    ]);
}
