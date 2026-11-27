import { NextResponse, type NextRequest } from 'next/server';
import { teamAccount } from '@/lib/auth';
import { query, value } from '@/lib/db';
import { csvResponse, sp } from '@/lib/http';
import { phpDate } from '@/lib/time';
import { templateValues } from '@/lib/services/sender';
import type { MessageRow } from '@/lib/types';
import { errorText, recipientStatus, recipientWhere } from '../../shared';
import { redirectTo } from '@/lib/redirect';

type Row = Pick<MessageRow, 'm_mobile_no' | 'm_status' | 'm_message_id' | 'm_delivery_status' | 'm_status_response' | 'm_in_process_on' | 'm_updated_on' | 'm_image' | 'm_msg_template_para'>;

/** The message's media links (m_image keeps public URLs, comma separated). */
const mediaLinks = (raw: string | null | undefined) => String(raw ?? '').split(',').map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s)).join(', ');

/**
 * GET /campaigns/{id}/export — recipients with status as CSV (CampaignController::export), streamed,
 * with the media link and the template parameters each one was sent with ({{1}}… columns as many as used).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const account = await teamAccount((p) => p.campaignView !== 'none');
  if (!account) return redirectTo('/');
  const { user, member, perms } = account;
  const id = parseInt((await ctx.params).id, 10);
  if (!Number.isFinite(id) || !(await value('SELECT 1 FROM js_user_campaign WHERE uc_id = $1 AND uc_user_id = $2 AND ($3::int = 0 OR uc_member_id = $3)', [id, user.u_id, member && perms.campaignView === 'own' ? member.um_id : 0]))) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const search = req.nextUrl.searchParams;
  const params: unknown[] = [];
  const where = recipientWhere(id, sp(search, 'status'), sp(search, 'mobile'), params);
  // Columns only for what the campaign used: the most body values, a text header, URL button values
  const paras = await query<{ p: string }>(`SELECT DISTINCT m_msg_template_para AS p FROM js_message WHERE ${where} AND COALESCE(m_msg_template_para, '') <> ''`, params);
  let bodyCount = 0;
  let hasHeader = false;
  const buttonKeys = new Set<string>();
  for (const { p } of paras) {
    const v = templateValues(p);
    bodyCount = Math.max(bodyCount, v.body.length);
    if (v.header !== null) hasHeader = true;
    Object.keys(v.buttons).forEach((k) => buttonKeys.add(k));
  }
  const buttons = [...buttonKeys].sort((a, b) => Number(a) - Number(b));

  return csvResponse<Row>(
    `campaign-${id}-recipients.csv`,
    ['Mobile', 'Status', 'Sent At', 'Updated At', 'Error', 'Media Link',
      ...(hasHeader ? ['Header {{1}}'] : []),
      ...Array.from({ length: bodyCount }, (_, i) => `{{${i + 1}}}`),
      ...buttons.map((k) => `Button ${Number(k) + 1} URL value`)],
    `SELECT m_id, m_mobile_no, m_status, m_message_id, m_delivery_status, m_status_response, m_in_process_on, m_updated_on, m_image, m_msg_template_para
       FROM js_message WHERE ${where} ORDER BY m_id`,
    params,
    (m) => {
      const state = recipientStatus(m);
      const v = templateValues(m.m_msg_template_para);
      return [
        m.m_mobile_no,
        state,
        m.m_in_process_on ? phpDate('Y-m-d H:i', Number(m.m_in_process_on)) : '',
        m.m_updated_on ? phpDate('Y-m-d H:i', Number(m.m_updated_on)) : '',
        state === 'Failed' ? errorText(m.m_status_response) : '',
        mediaLinks(m.m_image),
        ...(hasHeader ? [v.header ?? ''] : []),
        ...Array.from({ length: bodyCount }, (_, i) => v.body[i] ?? ''),
        ...buttons.map((k) => v.buttons[k] ?? ''),
      ];
    },
  );
}
