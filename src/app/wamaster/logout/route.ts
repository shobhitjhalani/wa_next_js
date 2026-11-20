import { logActivity } from '@/lib/activity';
import { endAdminSession } from '@/lib/auth';
import { redirectTo } from '@/lib/redirect';

/** Admin sign-out (GET or POST, like the Laravel route). */
async function logout() {
  await logActivity({ module: 'auth', action: 'Signed out' });
  await endAdminSession();
  return redirectTo('/wamaster', 303);
}

export { logout as GET, logout as POST };
