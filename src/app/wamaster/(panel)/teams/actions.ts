'use server';

import { revalidatePath } from 'next/cache';
import { forbidden, notFound, redirect } from 'next/navigation';
import { fAll, flash, fRaw, fStr, invalid, isEmail, type ActionResult } from '@/lib/actions';
import { requireAdminCan } from '@/lib/auth';
import { exec, insert, insertMany, one, tx, update, value } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { now } from '@/lib/time';
import { SUPER_ADMIN } from '@/lib/types';

const len = (s: string) => Array.from(s).length;

/** Store / update a team member and their page rights (TeamController::save). */
export async function saveMember(id: number | null, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const me = await requireAdminCan('employee');
  if (id !== null && !Number.isInteger(id)) notFound();
  const member = id ? await one<{ emp_id: number; emp_code: string | null }>('SELECT emp_id, emp_code FROM js_employee WHERE emp_id = $1 AND emp_dstatus = 0', [id]) : null;
  if (id && !member) notFound();

  const name = fStr(fd, 'name');
  const mobile = fStr(fd, 'mobile');
  const email = fStr(fd, 'email_id');
  const username = fStr(fd, 'username');
  const password = fRaw(fd, 'password');
  const rightId = fStr(fd, 'right_id');
  const mType = fStr(fd, 'm_type');
  const status = fStr(fd, 'status');
  const address = fStr(fd, 'address');
  const rights = fAll(fd, 'rights[]').map((r) => r.trim()).filter((r) => r !== '');

  const errors: Record<string, string> = {};
  if (!name) errors.name = 'The name field is required.';
  else if (len(name) > 100) errors.name = 'The name field must not be greater than 100 characters.';
  if (len(mobile) > 100) errors.mobile = 'The mobile field must not be greater than 100 characters.';
  if (email && !isEmail(email)) errors.email_id = 'The email id field must be a valid email address.';
  else if (len(email) > 255) errors.email_id = 'The email id field must not be greater than 255 characters.';
  if (!username) errors.username = 'The username field is required.';
  else if (len(username) > 100) errors.username = 'The username field must not be greater than 100 characters.';
  else if (await value<boolean>('SELECT EXISTS (SELECT 1 FROM js_employee WHERE emp_username = $1 AND emp_dstatus = 0 AND emp_id <> $2)', [username, member?.emp_id ?? 0])) {
    errors.username = 'The username has already been taken.';
  }
  if (password === '') {
    if (!member) errors.password = 'The password field is required.';
  } else if (len(password) < 6) errors.password = 'The password field must be at least 6 characters.';
  if (rightId !== '' && !(/^[+-]?\d+$/.test(rightId) && Math.abs(Number(rightId)) <= 32767)) errors.right_id = 'The right id field must be an integer.';
  if (mType === '') errors.m_type = 'The m type field is required.';
  else if (!['1', '4'].includes(mType)) errors.m_type = 'The selected m type is invalid.';
  if (status === '') errors.status = 'The status field is required.';
  else if (!['1', '2'].includes(status)) errors.status = 'The selected status is invalid.';
  if (len(address) > 255) errors.address = 'The address field must not be greater than 255 characters.';
  rights.forEach((r, i) => {
    if (len(r) > 50) errors[`rights.${i}`] = `The rights.${i} field must not be greater than 50 characters.`;
  });
  if (Object.keys(errors).length) return invalid(errors);

  // Only a super admin may create or promote super admins
  if (Number(mType) === SUPER_ADMIN && !me.isSuperAdmin) forbidden();

  const ts = now();
  const row = {
    emp_name: name,
    emp_mobile: mobile || null,
    emp_email_id: email || null,
    emp_username: username,
    emp_right_id: rightId === '' ? 0 : Number(rightId),
    emp_m_type: Number(mType),
    emp_status: Number(status),
    emp_address: address || null,
    emp_updated_on: ts,
    ...(password !== '' ? { emp_password: await hashPassword(password) } : {}),
  };

  await tx(async (db) => {
    let empId: number;
    let code: string | null;
    if (member) {
      await update('js_employee', row, 'emp_id = $1', [member.emp_id], db);
      empId = member.emp_id;
      code = member.emp_code;
    } else {
      const created = await insert<{ emp_id: number; emp_code: string | null }>('js_employee', { ...row, emp_created_on: ts }, 'emp_id, emp_code', db);
      empId = created.emp_id;
      code = created.emp_code;
    }
    if (!code) await exec('UPDATE js_employee SET emp_code = $2 WHERE emp_id = $1', [empId, 'EMP' + String(empId).padStart(4, '0')], db);

    await exec('DELETE FROM js_employee_rights WHERE er_emp_id = $1', [empId], db);
    await insertMany('js_employee_rights', rights.map((r) => ({ er_emp_id: empId, er_page_action: r, er_created_on: ts, er_created_by: me.emp_id })), { db });
  });

  await flash('success', 'Team member saved');
  redirect('/wamaster/teams');
}

/** Soft-delete a team member (TeamController::destroy). */
export async function deleteMember(id: number): Promise<void> {
  const me = await requireAdminCan('employee');
  if (!Number.isInteger(id)) notFound();
  if (id === me.emp_id) {
    await flash('error', 'You cannot delete yourself.');
  } else {
    await exec('UPDATE js_employee SET emp_dstatus = 1, emp_status = 2 WHERE emp_id = $1 AND emp_dstatus = 0', [id]);
    await flash('success', 'Record Successfully Deleted');
  }
  revalidatePath('/wamaster/teams');
}
