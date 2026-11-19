import type { NextRequest } from 'next/server';
import { assignedParam, inboxAccess } from '../access';
import { conversationPage, labelParam, unreadTotal } from '../inbox';
import type { ListResponse } from '../types';

/** GET /chat/conversations — one page of conversations, newest first. */
export async function GET(req: NextRequest) {
  const access = await inboxAccess();
  if (!access) return Response.json({ message: 'Unauthenticated.' }, { status: 401 });
  const { user } = access;
  const p = req.nextUrl.searchParams;
  const beforeRaw = (p.get('before') ?? '').trim();
  const before = beforeRaw !== '' ? parseInt(beforeRaw, 10) || 0 : null;

  const [page, total] = await Promise.all([
    conversationPage(user.u_id, {
      filter: p.get('filter') ?? '', q: p.get('q') ?? '', label: labelParam(p.get('label')), scope: access.scope, assigned: assignedParam(p.get('assigned')),
    }, before),
    unreadTotal(user.u_id, access.scope),
  ]);
  return Response.json({ ...page, unread_total: total } satisfies ListResponse);
}
