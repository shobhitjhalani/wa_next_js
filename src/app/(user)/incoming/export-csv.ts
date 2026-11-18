import 'server-only';
import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { url } from '@/lib/config';
import { messageSummary } from '@/lib/format';
import { csvResponse } from '@/lib/http';
import { phpDate } from '@/lib/time';
import type { MessageRow } from '@/lib/types';
import { incomingFilter } from './filter';

type Row = Pick<MessageRow, 'm_id' | 'm_created_on' | 'm_sender_name' | 'm_mobile_no' | 'm_is_read' | 'm_content' | 'm_msg_type' | 'm_msg_template_name' | 'm_msg_template_para'>;

/** CSV of the Incoming / Attachments listing with its current filters (every page), newest first. */
export async function incomingCsv(req: NextRequest, attachments: boolean): Promise<Response> {
  const user = await requireUser();
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const { where, args } = incomingFilter(user.u_id, params, attachments);
  const header = ['Date', 'Sender Name', 'Mobile No', attachments ? 'Type' : 'Message', 'Status', ...(attachments ? ['Caption', 'View Link'] : [])];
  const name = `${attachments ? 'incoming_attachments' : 'incoming_messages'}_${phpDate('d-m-Y_His')}.csv`;
  return csvResponse<Row>(
    name, header,
    `SELECT m_id, m_created_on, m_sender_name, m_mobile_no, m_is_read, m_content, m_msg_type, m_msg_template_name, m_msg_template_para
       FROM js_message WHERE ${where} ORDER BY m_id DESC`,
    args,
    (m) => {
      const status = Number(m.m_is_read) === 2 ? 'Un-Read' : 'Read';
      const date = phpDate('d-m-Y H:i:s', Number(m.m_created_on));
      if (!attachments) return [date, m.m_sender_name ?? '', m.m_mobile_no ?? '', messageSummary(m), status];
      const caption = m.m_content && m.m_content !== 'File_Attachment' ? m.m_content : '';
      return [date, m.m_sender_name ?? '', m.m_mobile_no ?? '', m.m_msg_type ?? '', status, caption, url(`/view_attachment/${m.m_id}`)];
    },
  );
}
