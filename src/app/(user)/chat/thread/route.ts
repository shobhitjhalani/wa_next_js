import type { NextRequest } from 'next/server';
import { getUser } from '@/lib/auth';
import { contactWindowLeft } from '@/lib/format';
import { bubbles, cleanMobile, contact, convRow, markRead, threadHeader, threadPage, unreadTotal } from '../inbox';
import type { ThreadResponse } from '../types';

/** GET /chat/thread — thread page. Without `before` it is the newest page, and opening it marks the conversation read. */
export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return Response.json({ message: 'Unauthenticated.' }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const mobile = cleanMobile(p.get('mb'));
  const beforeRaw = (p.get('before') ?? '').trim();
  const before = beforeRaw !== '' ? parseInt(beforeRaw, 10) || 0 : null;

  const { messages, more } = await threadPage(user.u_id, mobile, before);
  const payload: ThreadResponse = {
    messages: await bubbles(user.u_id, messages),
    oldest: messages[0]?.m_id ?? null,
    newest: messages[messages.length - 1]?.m_id ?? null,
    more,
  };

  if (before === null) {
    await markRead(user.u_id, mobile);
    const [c, total] = await Promise.all([contact(user.u_id, mobile), unreadTotal(user.u_id)]);
    payload.header = threadHeader(c);
    payload.window_left = contactWindowLeft(c);
    payload.row = c.exists ? convRow(c) : null;
    payload.unread_total = total;
  }
  return Response.json(payload);
}
