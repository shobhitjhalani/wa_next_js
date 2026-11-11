import { endUserSession } from '@/lib/auth';
import { redirectTo } from '@/lib/redirect';

/** User sign-out; GET and POST like the Laravel route (Route::match(['get','post'], 'logout')). */
async function logout() {
  await endUserSession();
  return redirectTo('/', 303);
}

export { logout as GET, logout as POST };
