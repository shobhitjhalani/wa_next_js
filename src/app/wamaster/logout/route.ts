import { NextResponse, type NextRequest } from 'next/server';
import { endAdminSession } from '@/lib/auth';

/** Admin sign-out (GET or POST, like the Laravel route). */
async function logout(req: NextRequest) {
  await endAdminSession();
  return NextResponse.redirect(new URL('/wamaster', req.url), 303);
}

export { logout as GET, logout as POST };
