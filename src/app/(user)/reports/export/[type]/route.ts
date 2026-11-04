import { NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { messageStatusLabel } from '@/lib/format';
import { csvResponse } from '@/lib/http';
import { decodeEntities } from '@/lib/text';
import { phpDate } from '@/lib/time';
import type { MessageRow } from '@/lib/types';
import { reportFilter, type ReportType } from '../../query';

type Row = Pick<MessageRow, 'm_created_on' | 'm_sender_name' | 'm_mobile_no' | 'm_msg_template_name' | 'm_content' | 'm_sheet_id'
  | 'm_delivery_status' | 'm_updated_on' | 'm_status' | 'm_message_id' | 'm_status_response'>;

/** CSV of a message report with the page's filters (GET /reports/export/{all|failed|error}). */
export async function GET(req: Request, ctx: { params: Promise<{ type: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL('/', req.url));
  const { type } = await ctx.params;
  if (!['all', 'failed', 'error'].includes(type)) return new Response('Not Found', { status: 404 });

  const { where, args } = reportFilter(user.u_id, type as ReportType, new URL(req.url).searchParams);
  // The CTE is planned for all rows (the cursor's top level is planned for a fast start, which
  // would pick a backward walk of the primary key filtering every user's messages).
  return csvResponse<Row>(
    `${type}_messages_${phpDate('d_m_y')}.csv`,
    ['S. No.', 'Date of Created', 'Name', 'Mobile No', 'Template Name', 'Message Content', 'Sheet ID', 'Delivery Status', 'Send On', 'Remark'],
    `WITH f AS MATERIALIZED (
       SELECT m_id, m_created_on, m_sender_name, m_mobile_no, m_msg_template_name, m_content, m_sheet_id,
              m_delivery_status, m_updated_on, m_status, m_message_id, m_status_response
         FROM js_message WHERE ${where})
     SELECT * FROM f ORDER BY m_id DESC`,
    args,
    (m, i) => [
      i + 1,
      m.m_created_on ? phpDate('d-m-Y H:i:s', m.m_created_on) : '',
      m.m_sender_name,
      m.m_mobile_no,
      m.m_msg_template_name,
      decodeEntities(m.m_content ?? ''),
      m.m_sheet_id,
      m.m_delivery_status,
      m.m_updated_on ? phpDate('d-m-Y H:i:s', m.m_updated_on) : '',
      m.m_delivery_status === 'failed' || type === 'error' ? messageStatusLabel(m) : '',
    ],
  );
}
