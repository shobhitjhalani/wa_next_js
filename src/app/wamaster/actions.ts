'use server';

import { redirect } from 'next/navigation';
import { fail, fBool, fStr, invalid, type ActionResult } from '@/lib/actions';
import { startAdminSession } from '@/lib/auth';
import { exec, one } from '@/lib/db';
import { checkPassword, hashPassword, needsUpgrade } from '@/lib/password';
import type { EmployeeRow } from '@/lib/types';

/** Admin sign-in (Admin\AuthController::login). */
export async function loginAdmin(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const username = fStr(fd, 'username');
  const password = fStr(fd, 'password');
  const errors: Record<string, string> = {};
  if (!username) errors.username = 'Please enter username';
  if (!password) errors.password = 'Please enter password';
  if (Object.keys(errors).length) return invalid(errors);

  const emp = await one<Pick<EmployeeRow, 'emp_id' | 'emp_name' | 'emp_password'>>(
    'SELECT emp_id, emp_name, emp_password FROM js_employee WHERE emp_dstatus = 0 AND emp_is_left = 0 AND emp_status = 1 AND emp_username = $1 ORDER BY emp_id LIMIT 1',
    [username],
  );
  if (!emp || !(await checkPassword(password, emp.emp_password))) {
    return fail('Invalid Username or Password', { username: 'Invalid Username or Password' });
  }
  const upgraded = needsUpgrade(emp.emp_password) ? await hashPassword(password) : emp.emp_password;
  await exec('UPDATE js_employee SET emp_password = $2, emp_is_login = 1, emp_last_active = $3 WHERE emp_id = $1', [emp.emp_id, upgraded, Math.floor(Date.now() / 1000)]);

  await startAdminSession(emp, fBool(fd, 'remember'));
  redirect('/wamaster/dashboard');
}
