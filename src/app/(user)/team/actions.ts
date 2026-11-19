'use server';

import { revalidatePath } from 'next/cache';
import { fail, flash, fInt, fStr, invalid, isEmail, ok, type ActionResult } from '@/lib/actions';
import { requireAccount, requireUser } from '@/lib/auth';
import { exec, one, value } from '@/lib/db';
import { checkPassword, hashPassword } from '@/lib/password';
import { normalizePhone } from '@/lib/phone';
import { normalizePerms } from '@/lib/team';
import { now } from '@/lib/time';

/** Add a team member, or edit one (um_id set; an empty password keeps the current one). Owner only. */
export async function saveMember(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = fInt(fd, 'um_id');
  const name = fStr(fd, 'name').slice(0, 100);
  const username = fStr(fd, 'username').toLowerCase();
  const email = fStr(fd, 'email').toLowerCase();
  const rawMobile = fStr(fd, 'mobile');
  const password = fStr(fd, 'password');
  const errors: Record<string, string> = {};
  if (!name) errors.name = 'The name field is required.';
  if (!/^[a-z0-9._@-]{3,60}$/.test(username)) errors.username = 'Use 3–60 letters, digits, dots, dashes or underscores.';
  if (email && !isEmail(email)) errors.email = 'Enter a valid email address.';
  const mobile = rawMobile ? normalizePhone(rawMobile) : '';
  if (rawMobile && !mobile) errors.mobile = 'Enter a valid mobile number.';
  if (!id && password.length < 6) errors.password = 'The password must be at least 6 characters.';
  if (id && password && password.length < 6) errors.password = 'The password must be at least 6 characters.';
  if (!errors.username) {
    // Usernames are shared with account logins (same login page), so they must be unique across both
    const taken = await value<number>(
      `SELECT 1 WHERE EXISTS (SELECT 1 FROM js_user WHERE u_username = $1 AND u_dstatus = 0)
          OR EXISTS (SELECT 1 FROM js_user_member WHERE um_username = $1 AND um_id <> $2)`, [username, id]);
    if (taken) errors.username = 'This username is already taken. Choose another one.';
  }
  if (Object.keys(errors).length) return invalid(errors);

  const perms = normalizePerms({
    template: fStr(fd, 'perm_template'),
    campaignCreate: fd.get('perm_campaign_create') === '1',
    campaignView: fStr(fd, 'perm_campaign_view'),
    inbox: fStr(fd, 'perm_inbox'),
  });
  const status = fd.get('active') === '1' ? 1 : 2;

  if (id) {
    const n = await exec(
      `UPDATE js_user_member SET um_name = $3, um_username = $4, um_email = $5, um_mobile = $6, um_perms = $7, um_status = $8
              ${password ? ', um_password = $9' : ''}
        WHERE um_id = $1 AND um_user_id = $2`,
      [id, user.u_id, name, username, email, mobile ?? '', JSON.stringify(perms), status, ...(password ? [await hashPassword(password)] : [])]);
    if (!n) return fail('This team member no longer exists.');
    // Their open chats stay assigned; with Inbox "No access" they simply can't open them
    revalidatePath('/team');
    return ok(`${name} updated.`);
  }
  await exec(
    `INSERT INTO js_user_member (um_user_id, um_name, um_username, um_email, um_mobile, um_password, um_perms, um_status, um_created_on)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [user.u_id, name, username, email, mobile ?? '', await hashPassword(password), JSON.stringify(perms), status, now()]);
  revalidatePath('/team');
  return ok(`${name} added. They sign in on the normal login page with the username “${username}”.`);
}

/** Remove a member; chats assigned to them become unassigned. Owner only. */
export async function deleteMember(id: number): Promise<void> {
  const user = await requireUser();
  const m = await one<{ um_name: string }>('DELETE FROM js_user_member WHERE um_id = $1 AND um_user_id = $2 RETURNING um_name', [id, user.u_id]);
  if (m) await exec('UPDATE js_user_contact_list SET cl_assigned_member = 0 WHERE cl_user_id = $1 AND cl_assigned_member = $2', [user.u_id, id]);
  await flash(m ? 'success' : 'error', m ? `${m.um_name} removed from the team. Their chats are now unassigned.` : 'This team member no longer exists.');
  revalidatePath('/team');
}

/** A team member changes their own password. */
export async function changeMemberPassword(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { member } = await requireAccount();
  if (!member) return fail('Change the account password on the Profile page.');
  const current = fStr(fd, 'current_password');
  const next = fStr(fd, 'new_password');
  const errors: Record<string, string> = {};
  const row = await one<{ um_password: string }>('SELECT um_password FROM js_user_member WHERE um_id = $1', [member.um_id]);
  if (!row || !(await checkPassword(current, row.um_password))) errors.current_password = 'The current password is not correct.';
  if (next.length < 6) errors.new_password = 'The new password must be at least 6 characters.';
  if (next && next !== fStr(fd, 'new_password_confirmation')) errors.new_password_confirmation = 'The passwords do not match.';
  if (Object.keys(errors).length) return invalid(errors);
  await exec('UPDATE js_user_member SET um_password = $2 WHERE um_id = $1', [member.um_id, await hashPassword(next)]);
  return ok('Your password was changed.');
}
