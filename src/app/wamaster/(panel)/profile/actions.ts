'use server';

import { revalidatePath } from 'next/cache';
import { flash, fRaw, fStr, invalid, isEmail, ok, type ActionResult } from '@/lib/actions';
import { requireAdmin } from '@/lib/auth';
import { exec } from '@/lib/db';
import { checkPassword, hashPassword } from '@/lib/password';
import { now } from '@/lib/time';

/** Admin\ProfileController::update */
export async function updateProfile(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const me = await requireAdmin();
  const name = fStr(fd, 'name');
  const mobile = fStr(fd, 'mobile');
  const email = fStr(fd, 'email_id');
  const errors: Record<string, string> = {};
  if (!name) errors.name = 'The name field is required.';
  else if (name.length > 100) errors.name = 'The name field must not be greater than 100 characters.';
  if (mobile.length > 100) errors.mobile = 'The mobile field must not be greater than 100 characters.';
  if (email && !isEmail(email)) errors.email_id = 'The email id field must be a valid email address.';
  else if (email.length > 255) errors.email_id = 'The email id field must not be greater than 255 characters.';
  if (Object.keys(errors).length) return invalid(errors);

  await exec(
    'UPDATE js_employee SET emp_name = $2, emp_mobile = $3, emp_email_id = $4, emp_updated_on = $5 WHERE emp_id = $1',
    [me.emp_id, name, mobile || null, email || null, now()],
  );
  await flash('success', 'Profile updated');
  revalidatePath('/wamaster', 'layout');
  return ok();
}

/** Admin\ProfileController::password */
export async function changePassword(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const me = await requireAdmin();
  const current = fRaw(fd, 'current_password');
  const password = fRaw(fd, 'password');
  const errors: Record<string, string> = {};
  if (!current.trim()) errors.current_password = 'The current password field is required.';
  if (!password.trim()) errors.password = 'The password field is required.';
  else if (password.length < 6) errors.password = 'The password field must be at least 6 characters.';
  else if (password !== fRaw(fd, 'password_confirmation')) errors.password = 'The password field confirmation does not match.';
  if (Object.keys(errors).length) return invalid(errors);

  if (!(await checkPassword(current, me.emp_password))) return invalid({ current_password: 'Invalid Password' });
  await exec('UPDATE js_employee SET emp_password = $2 WHERE emp_id = $1', [me.emp_id, await hashPassword(password)]);
  await flash('success', 'Password Successfully Changed');
  revalidatePath('/wamaster/profile');
  return ok();
}
