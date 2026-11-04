'use server';

import { revalidatePath } from 'next/cache';
import { flash, fRaw, fStr, invalid, isEmail, ok, type ActionResult } from '@/lib/actions';
import { requireUser } from '@/lib/auth';
import { exec, value } from '@/lib/db';
import { checkPassword, hashPassword } from '@/lib/password';
import { now } from '@/lib/time';

/** Email / mobile (User\ProfileController::update). */
export async function updateProfile(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const email = fStr(fd, 'email');
  const mobile = fStr(fd, 'mobile');

  const errors: Record<string, string> = {};
  if (email) {
    if (!isEmail(email)) errors.email = 'The email field must be a valid email address.';
    else if (email.length > 255) errors.email = 'The email field must not be greater than 255 characters.';
    else if (await value('SELECT 1 FROM js_user WHERE u_email_id = $1 AND u_id <> $2 AND u_dstatus = 0 LIMIT 1', [email, user.u_id])) {
      errors.email = 'The email has already been taken.';
    }
  }
  if (mobile.length > 25) errors.mobile = 'The mobile field must not be greater than 25 characters.';
  if (Object.keys(errors).length) return invalid(errors);

  await exec('UPDATE js_user SET u_email_id = $2, u_mobile_no = $3, u_updated_on = $4 WHERE u_id = $1', [
    user.u_id, email.toLowerCase(), mobile || null, now(),
  ]);
  await flash('success', 'Profile updated');
  revalidatePath('/profile');
  return ok();
}

/** Change password (User\ProfileController::password). */
export async function changePassword(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const current = fRaw(fd, 'current_password');
  const password = fRaw(fd, 'password');
  const confirmation = fRaw(fd, 'password_confirmation');

  const errors: Record<string, string> = {};
  if (!current) errors.current_password = 'The current password field is required.';
  if (!password) errors.password = 'The password field is required.';
  else if (password.length < 6) errors.password = 'The password field must be at least 6 characters.';
  else if (password !== confirmation) errors.password = 'The password field confirmation does not match.';
  if (Object.keys(errors).length) return invalid(errors);

  if (!(await checkPassword(current, user.u_password))) return invalid({ current_password: 'Invalid Password' });

  await exec('UPDATE js_user SET u_password = $2, u_updated_on = $3 WHERE u_id = $1', [user.u_id, await hashPassword(password), now()]);
  await flash('success', 'Password Successfully Changed');
  revalidatePath('/profile');
  return ok();
}
