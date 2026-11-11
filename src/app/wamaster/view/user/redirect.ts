import { NextResponse, type NextRequest } from 'next/server';
import { redirectTo } from '@/lib/redirect';

const PAGES = ['index', 'view', 'add', 'wa_view', 'gs_view'];

/** wamaster/view/user[/view|/add]?ut=…&id=… → users index / show / edit / create (301). */
export function legacyUserRedirect(req: NextRequest, page: string): Response {
  if (!PAGES.includes(page)) return new NextResponse('Not Found', { status: 404 });
  const q = req.nextUrl.searchParams;
  const id = parseInt(q.get('id') ?? '', 10) || 0;
  const ut = q.get('ut') ?? '';
  const to = (path: string) => redirectTo(path, 301);
  if (id > 0 && page === 'add') return to(`/wamaster/users/${id}/edit`);
  if (id > 0) return to(`/wamaster/users/${id}`);
  if (page === 'add') return to(ut !== '' ? `/wamaster/users/create?ut=${encodeURIComponent(ut)}` : '/wamaster/users/create');
  return to(ut !== '' && ut !== '0' ? `/wamaster/users?ut=${encodeURIComponent(ut)}` : '/wamaster/users');
}
