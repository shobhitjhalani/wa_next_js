import { getAdmin } from '@/lib/auth';
import { messageStatusLabel } from '@/lib/format';
import { csvResponse } from '@/lib/http';
import { decodeEntities } from '@/lib/text';
import { phpDate } from '@/lib/time';
import type { MessageRow } from '@/lib/types';
import { MESSAGE_REPORTS, messageOrder, messageWhere, type Params } from '../../../_lib';
import { redirectTo } from '@/lib/redirect';

/** CSV export of a message report (ReportController::export). */
export async function GET(req: Request, ctx: { params: Promise<{ type: string }> }) {
  const admin = await getAdmin();
  if (!admin) return redirectTo('/wamaster', 302);
  const { type } = await ctx.params;
  if (!MESSAGE_REPORTS[type]) return new Response('Not Found', { status: 404 });

  const params: Params = {};
  for (const [k, v] of new URL(req.url).searchParams) if (!(k in params)) params[k] = v;
  const { where, statusWhere, args, ranged } = messageWhere(params, type);

  return csvResponse<MessageRow & { u_username: string | null } & Record<string, unknown>>(
    `wa_${type}_${phpDate('d_m_y')}.csv`,
    ['Username', 'Created', 'Mobile', 'Type', 'Template', 'Parameters', 'Content', 'Sheet ID', 'Status', 'Updated'],
    `SELECT m.m_created_on, m.m_mobile_no, m.m_msg_type, m.m_msg_template_name, m.m_msg_template_para, m.m_content, m.m_sheet_id,
            m.m_status, m.m_message_id, m.m_delivery_status, m.m_status_response, m.m_updated_on, u.u_username
       FROM js_message m LEFT JOIN js_user u ON u.u_id = m.m_user_id
      WHERE ${where} AND ${statusWhere}
      ORDER BY ${messageOrder(ranged)}`,
    args,
    (m) => [
      m.u_username,
      m.m_created_on ? phpDate('d-m-Y H:i:s', m.m_created_on) : '',
      m.m_mobile_no,
      m.m_msg_type,
      m.m_msg_template_name,
      m.m_msg_template_para,
      decodeEntities(m.m_content ?? ''),
      m.m_sheet_id,
      messageStatusLabel(m),
      m.m_updated_on ? phpDate('d-m-Y H:i:s', m.m_updated_on) : '',
    ],
  );
}
