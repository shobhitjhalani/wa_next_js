import type { NextRequest } from 'next/server';
import { getUser } from '@/lib/auth';
import { conversationPage, unreadTotal } from '../inbox';
import type { ListResponse } from '../types';

/** GET /chat/conversations — one page of conversations, newest first. */
export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return Response.json({ message: 'Unauthenticated.' }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const beforeRaw = (p.get('before') ?? '').trim();
  const before = beforeRaw !== '' ? parseInt(beforeRaw, 10) || 0 : null;

  const [page, total] = await Promise.all([
    conversationPage(user.u_id, { filter: p.get('filter') ?? '', q: p.get('q') ?? '' }, before),
    unreadTotal(user.u_id),
  ]);
  return Response.json({ ...page, unread_total: total } satisfies ListResponse);
}
