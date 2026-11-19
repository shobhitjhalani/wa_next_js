import type { NextRequest } from 'next/server';
import { canOpenChat, inboxAccess, NOT_YOURS } from '../access';
import { contactWindowLeft } from '@/lib/format';
import { bubbles, cleanMobile, contact, convRow, markRead, threadHeader, threadPage, unreadTotal } from '../inbox';
import type { ThreadResponse } from '../types';

/** GET /chat/thread — thread page. Without `before` it is the newest page, and opening it marks the conversation read. */
export async function GET(req: NextRequest) {
  const access = await inboxAccess();
  if (!access) return Response.json({ message: 'Unauthenticated.' }, { status: 401 });
  const { user } = access;
  const p = req.nextUrl.searchParams;
  const mobile = cleanMobile(p.get('mb'));
  const beforeRaw = (p.get('before') ?? '').trim();
  const before = beforeRaw !== '' ? parseInt(beforeRaw, 10) || 0 : null;

  if (!(await canOpenChat(access, mobile))) return Response.json({ message: NOT_YOURS }, { status: 403 });

  const { messages, more } = await threadPage(user.u_id, mobile, before);
  const payload: ThreadResponse = {
    messages: await bubbles(user.u_id, messages),
    oldest: messages[0]?.m_id ?? null,
    newest: messages[messages.length - 1]?.m_id ?? null,
    more,
  };

  if (before === null) {
    await markRead(user.u_id, mobile);
    const [c, total] = await Promise.all([contact(user.u_id, mobile), unreadTotal(user.u_id, access.scope)]);
    payload.header = threadHeader(c);
    payload.window_left = contactWindowLeft(c);
    payload.row = c.exists ? convRow(c) : null;
    payload.assigned = Number(c.cl_assigned_member) || 0;
    payload.unread_total = total;
  }
  return Response.json(payload);
}
