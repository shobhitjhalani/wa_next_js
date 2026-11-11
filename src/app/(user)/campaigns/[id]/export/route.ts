import { NextResponse, type NextRequest } from 'next/server';
import { getUser } from '@/lib/auth';
import { value } from '@/lib/db';
import { csvResponse, sp } from '@/lib/http';
import { phpDate } from '@/lib/time';
import type { MessageRow } from '@/lib/types';
import { errorText, recipientStatus, recipientWhere } from '../../shared';
import { redirectTo } from '@/lib/redirect';

type Row = Pick<MessageRow, 'm_mobile_no' | 'm_status' | 'm_message_id' | 'm_delivery_status' | 'm_status_response' | 'm_in_process_on' | 'm_updated_on'>;

/** GET /campaigns/{id}/export — recipients with status as CSV (CampaignController::export), streamed. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return redirectTo('/');
  const id = parseInt((await ctx.params).id, 10);
  if (!Number.isFinite(id) || !(await value('SELECT 1 FROM js_user_campaign WHERE uc_id = $1 AND uc_user_id = $2', [id, user.u_id]))) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const search = req.nextUrl.searchParams;
  const params: unknown[] = [];
  const where = recipientWhere(id, sp(search, 'status'), sp(search, 'mobile'), params);
  return csvResponse<Row>(
    `campaign-${id}-recipients.csv`,
    ['Mobile', 'Status', 'Sent At', 'Updated At', 'Error'],
    `SELECT m_id, m_mobile_no, m_status, m_message_id, m_delivery_status, m_status_response, m_in_process_on, m_updated_on
       FROM js_message WHERE ${where} ORDER BY m_id`,
    params,
    (m) => {
      const state = recipientStatus(m);
      return [
        m.m_mobile_no,
        state,
        m.m_in_process_on ? phpDate('Y-m-d H:i', Number(m.m_in_process_on)) : '',
        m.m_updated_on ? phpDate('Y-m-d H:i', Number(m.m_updated_on)) : '',
        state === 'Failed' ? errorText(m.m_status_response) : '',
      ];
    },
  );
}
