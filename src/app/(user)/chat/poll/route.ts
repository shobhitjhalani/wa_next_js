import type { NextRequest } from 'next/server';
import { getUser } from '@/lib/auth';
import { contactWindowLeft } from '@/lib/format';
import { now } from '@/lib/time';
import { bubbles, changedConversations, cleanMobile, contact, markRead, newMessages, statusChanges, unreadTotal } from '../inbox';
import type { PollResponse } from '../types';

const INT = /^-?\d+$/;

/**
 * GET /chat/poll — changes since the last poll: updated conversations, new
 * messages in the open thread (marked read while the page is visible) and
 * delivery ticks.
 */
export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return Response.json({ message: 'Unauthenticated.' }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const sinceRaw = (p.get('since') ?? '').trim();
  const afterRaw = (p.get('after') ?? '').trim();
  const mbRaw = p.get('mb') ?? '';
  const errors: Record<string, string[]> = {};
  if (sinceRaw === '') errors.since = ['The since field is required.'];
  else if (!INT.test(sinceRaw)) errors.since = ['The since field must be an integer.'];
  if (afterRaw !== '' && !INT.test(afterRaw)) errors.after = ['The after field must be an integer.'];
  if (mbRaw.length > 20) errors.mb = ['The mb field must not be greater than 20 characters.'];
  if (Object.keys(errors).length) {
    return Response.json({ message: Object.values(errors)[0][0], errors }, { status: 422 });
  }

  const since = parseInt(sinceRaw, 10) - 2; // timestamps are per second; overlap rather than miss
  const after = afterRaw !== '' ? parseInt(afterRaw, 10) : 0;
  const filter = { filter: p.get('filter') ?? '', q: p.get('q') ?? '' };
  const mobile = cleanMobile(mbRaw);
  const visible = ['1', 'true'].includes((p.get('visible') ?? '').trim());

  const payload: PollResponse = { now: now(), rows: {}, messages: [], statuses: [], unread_total: 0 };
  const changed = await changedConversations(user.u_id, filter, since);
  for (const row of changed) payload.rows[row.mobile] = row;

  if (mobile) {
    const [fresh, statuses] = await Promise.all([
      newMessages(user.u_id, mobile, after),
      statusChanges(user.u_id, mobile, after, since),
    ]);
    const all = await bubbles(user.u_id, [...fresh, ...statuses]);
    payload.messages = all.slice(0, fresh.length);
    payload.newest = fresh[fresh.length - 1]?.m_id ?? null;
    payload.statuses = all.slice(fresh.length);
    if (visible && fresh.some((m) => Number(m.m_is_incoming) === 1)) await markRead(user.u_id, mobile);
    payload.window_left = contactWindowLeft(await contact(user.u_id, mobile));
  }
  payload.unread_total = await unreadTotal(user.u_id);
  return Response.json(payload);
}
