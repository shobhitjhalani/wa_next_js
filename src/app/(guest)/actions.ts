'use server';

import { redirect } from 'next/navigation';
import { fail, fBool, fStr, invalid, type ActionResult } from '@/lib/actions';
import { startMemberSession, startUserSession, type MemberRow } from '@/lib/auth';
import { exec, one } from '@/lib/db';
import { checkPassword, hashPassword, needsUpgrade } from '@/lib/password';
import { memberHome, normalizePerms } from '@/lib/team';
import type { UserRow } from '@/lib/types';

/** User panel sign-in (User\AuthController::login). */
export async function loginUser(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const username = fStr(fd, 'username');
  const password = fStr(fd, 'password');
  const errors: Record<string, string> = {};
  if (!username) errors.username = 'Please enter username';
  if (!password) errors.password = 'Please enter password';
  if (Object.keys(errors).length) return invalid(errors);

  // u_username is citext: case-insensitive match like the legacy LOWER() comparison
  const user = await one<Pick<UserRow, 'u_id' | 'u_name' | 'u_password' | 'u_status'>>(
    'SELECT u_id, u_name, u_password, u_status FROM js_user WHERE u_dstatus = 0 AND u_status IN (1, 3) AND u_username = $1 ORDER BY u_id LIMIT 1',
    [username],
  );
  if (!user) return loginMember(username, password, fBool(fd, 'remember'));
  if (!(await checkPassword(password, user.u_password))) return fail('Invalid Password', { password: 'Invalid Password' });
  if (Number(user.u_status) === 2) return fail('Please verify your email address before login.');

  if (needsUpgrade(user.u_password)) {
    await exec('UPDATE js_user SET u_password = $2 WHERE u_id = $1', [user.u_id, await hashPassword(password)]);
  }
  await startUserSession(user, fBool(fd, 'remember'));
  redirect('/dashboard');
}

/** A team member (js_user_member) signs in to their owner's account with their own username. */
async function loginMember(username: string, password: string, remember: boolean): Promise<ActionResult> {
  const member = await one<MemberRow & { um_password: string; owner_ok: boolean }>(
    `SELECT m.*, (u.u_id IS NOT NULL) AS owner_ok FROM js_user_member m
       LEFT JOIN js_user u ON u.u_id = m.um_user_id AND u.u_dstatus = 0 AND u.u_status IN (1, 3)
      WHERE m.um_username = $1`, [username]);
  if (!member) return fail("Username doesn't exist", { username: "Username doesn't exist" });
  if (!(await checkPassword(password, member.um_password))) return fail('Invalid Password', { password: 'Invalid Password' });
  if (Number(member.um_status) !== 1 || !member.owner_ok) return fail('This team login is disabled. Ask your account owner to enable it.');
  await startMemberSession(member, remember);
  redirect(memberHome(normalizePerms(member.um_perms)));
}
