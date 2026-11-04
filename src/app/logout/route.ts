import { NextResponse, type NextRequest } from 'next/server';
import { endUserSession } from '@/lib/auth';

/** User sign-out; GET and POST like the Laravel route (Route::match(['get','post'], 'logout')). */
async function logout(req: NextRequest) {
  await endUserSession();
  return NextResponse.redirect(new URL('/', req.url), 303);
}

export { logout as GET, logout as POST };
