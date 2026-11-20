'use server';

import { revalidatePath } from 'next/cache';
import { forbidden, notFound, redirect } from 'next/navigation';
import { fAll, flash, fRaw, fStr, invalid, isEmail, type ActionResult } from '@/lib/actions';
import { changes, logActivity } from '@/lib/activity';
import { requireRight } from '@/lib/admin-access';
import { exec, insert, insertMany, one, query, tx, update, value } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { config } from '@/lib/config';
import { now } from '@/lib/time';
import { SUPER_ADMIN } from '@/lib/types';

const len = (s: string) => Array.from(s).length;

/** "mlib_2" → "Media Library: Edit" (for the activity log). */
async function rightNames(codes: string[]): Promise<Map<string, string>> {
  const rows = await query<{ code: string; label: string }>(
    `SELECT mo.mo_code || '_' || ma.ma_id AS code, mo.mo_name || ': ' || ma.ma_name AS label FROM js_modules mo CROSS JOIN js_m_actions ma
      WHERE mo.mo_code || '_' || ma.ma_id = ANY($1::text[])`, [codes]);
  return new Map(rows.map((r) => [r.code, r.label]));
}

const MEMBER_FIELDS: Record<string, string> = {
  emp_name: 'Name', emp_mobile: 'Mobile', emp_email_id: 'Email', emp_username: 'Username', emp_password: 'Password',
  emp_right_id: 'Role', emp_m_type: 'Type', emp_status: 'Status', emp_address: 'Address',
};
const memberValue = (k: string, v: unknown): string => {
  if (k === 'emp_m_type') return Number(v) === SUPER_ADMIN ? 'Super admin' : 'Team member';
  if (k === 'emp_status') return Number(v) === 1 ? 'Active' : 'Inactive';
  return v === null || v === undefined || v === '' ? '—' : String(v);
};

/** Store / update a team member and their page rights (TeamController::save). */
export async function saveMember(id: number | null, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const me = (await requireRight('employee', id === null ? 'add' : 'edit')).admin;
  if (id !== null && !Number.isInteger(id)) notFound();
  const member = id ? await one<{ emp_id: number; emp_code: string | null; emp_m_type: number }>('SELECT emp_id, emp_code, emp_m_type FROM js_employee WHERE emp_id = $1 AND emp_dstatus = 0', [id]) : null;
  if (id && !member) notFound();
  // Only a super admin may change a super admin's account
  if (member && Number(member.emp_m_type) === SUPER_ADMIN && !me.isSuperAdmin) forbidden();

  const name = fStr(fd, 'name');
  const mobile = fStr(fd, 'mobile');
  const email = fStr(fd, 'email_id');
  const username = fStr(fd, 'username');
  const password = fRaw(fd, 'password');
  const rightId = fStr(fd, 'right_id');
  const mType = fStr(fd, 'm_type');
  const status = fStr(fd, 'status');
  const address = fStr(fd, 'address');
  let rights = fAll(fd, 'rights[]').map((r) => r.trim()).filter((r) => r !== '');

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
  if (rightId !== '') {
    if (!/^\d+$/.test(rightId) || Number(rightId) > 2147483647) errors.right_id = 'The right id field must be an integer.';
    else if (!(await value<boolean>('SELECT EXISTS (SELECT 1 FROM js_master_value WHERE mv_id = $1 AND mv_type = $2 AND mv_dstatus = 0)', [Number(rightId), config.masters.teamRole]))) {
      errors.right_id = 'The selected role is invalid.';
    }
  }
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
  // A team member can only grant (or take away) rights they have themselves; the member's other rights stay
  if (!me.isSuperAdmin) {
    const codes = async (empId: number) => (await query<{ er_page_action: string }>(
      'SELECT er_page_action FROM js_employee_rights WHERE er_emp_id = $1 AND er_dstatus = 0', [empId])).map((r) => r.er_page_action);
    const own = new Set(await codes(me.emp_id));
    const kept = member ? (await codes(member.emp_id)).filter((c) => !own.has(c)) : [];
    rights = [...new Set([...rights.filter((r) => own.has(r)), ...kept])];
  }

  const before = member ? await one<Record<string, unknown>>('SELECT * FROM js_employee WHERE emp_id = $1', [member.emp_id]) : null;
  const rightsBefore = member ? (await query<{ er_page_action: string }>(
    'SELECT er_page_action FROM js_employee_rights WHERE er_emp_id = $1 AND er_dstatus = 0', [member.emp_id])).map((r) => r.er_page_action) : [];
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

  const added = rights.filter((r) => !rightsBefore.includes(r)), removed = rightsBefore.filter((r) => !rights.includes(r));
  const names = await rightNames([...added, ...removed]);
  const details = [
    ...changes(member ? before : {}, row, MEMBER_FIELDS, memberValue).filter((d) => member || !/ → —$/.test(d)),
    ...added.map((r) => `Right given: ${names.get(r) ?? r}`), ...removed.map((r) => `Right taken away: ${names.get(r) ?? r}`),
  ];
  await logActivity({ module: 'teams', action: member ? 'Updated team member' : 'Added team member', target: `${name} (${username})`,
    targetId: member?.emp_id ?? '', details: details.length ? details : ['No field changed'] });
  await flash('success', 'Team member saved');
  redirect('/wamaster/teams');
}

/** Soft-delete a team member (TeamController::destroy). */
export async function deleteMember(id: number): Promise<void> {
  const me = (await requireRight('employee', 'delete')).admin;
  if (!Number.isInteger(id)) notFound();
  const target = await value<number>('SELECT emp_m_type FROM js_employee WHERE emp_id = $1 AND emp_dstatus = 0', [id]);
  if (Number(target) === SUPER_ADMIN && !me.isSuperAdmin) forbidden();
  if (id === me.emp_id) {
    await flash('error', 'You cannot delete yourself.');
  } else {
    const gone = await one<{ emp_name: string; emp_username: string }>(
      'UPDATE js_employee SET emp_dstatus = 1, emp_status = 2 WHERE emp_id = $1 AND emp_dstatus = 0 RETURNING emp_name, emp_username', [id]);
    if (gone) await logActivity({ module: 'teams', action: 'Deleted team member', target: `${gone.emp_name} (${gone.emp_username})`, targetId: id });
    await flash('success', 'Record Successfully Deleted');
  }
  revalidatePath('/wamaster/teams');
}
