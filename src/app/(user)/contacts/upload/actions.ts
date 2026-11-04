'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { fail, fBool, fFile, fileExt, fStr, invalid, type ActionResult } from '@/lib/actions';
import { requireUser } from '@/lib/auth';
import { exec, one, value } from '@/lib/db';
import { importContacts, ImportError, type ImportResult } from '@/lib/services/contacts-import';
import { now } from '@/lib/time';

const MAX_KB = 20480;

/** Upload contacts from CSV / TXT / XLSX (ContactController::upload). */
export async function uploadContacts(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const file = fFile(fd, 'file');
  const mode = fStr(fd, 'group_mode');
  const groupIdRaw = fStr(fd, 'group_id');
  const groupName = fStr(fd, 'group_name');

  const errors: Record<string, string> = {};
  if (!file) errors.file = 'The file field is required.';
  else if (file.size > MAX_KB * 1024) errors.file = `The file field must not be greater than ${MAX_KB} kilobytes.`;
  else if (!['csv', 'txt', 'xlsx'].includes(fileExt(file))) errors.file = 'Upload a .csv, .txt or .xlsx file. For .xls files, save as .xlsx or CSV first.';

  if (mode === '') errors.group_mode = 'The group mode field is required.';
  else if (!['none', 'existing', 'new'].includes(mode)) errors.group_mode = 'The selected group mode is invalid.';

  let group: { ug_id: number; up_group_name: string } | null = null;
  if (mode === 'existing' && groupIdRaw === '') errors.group_id = 'The group id field is required when group mode is existing.';
  else if (groupIdRaw !== '') {
    group = await one('SELECT ug_id, up_group_name FROM js_user_groups WHERE ug_id = $1 AND ug_user_id = $2', [parseInt(groupIdRaw, 10) || 0, user.u_id]);
    if (!group) errors.group_id = 'The selected group id is invalid.';
  }

  if (mode === 'new' && groupName === '') errors.group_name = 'The group name field is required when group mode is new.';
  else if (groupName !== '') {
    if (Array.from(groupName).length > 100) errors.group_name = 'The group name field must not be greater than 100 characters.';
    else if (await value('SELECT 1 FROM js_user_groups WHERE ug_user_id = $1 AND up_group_name = $2 LIMIT 1', [user.u_id, groupName])) {
      errors.group_name = 'You already have a group with this name — choose “Add to existing group”.';
    }
  }
  if (Object.keys(errors).length) return invalid(errors);

  if (mode === 'new') {
    group = await one('INSERT INTO js_user_groups (ug_user_id, up_group_name, ug_updated_on) VALUES ($1, $2, $3) RETURNING ug_id, up_group_name', [user.u_id, groupName, now()]);
  } else if (mode === 'none') {
    group = null;
  }

  let result: ImportResult;
  try {
    result = await importContacts(user.u_id, { bytes: Buffer.from(await file!.arrayBuffer()), extension: fileExt(file!) }, group?.ug_id ?? null, fBool(fd, 'overwrite_names'));
  } catch (e) {
    if (mode === 'new' && group) {
      await exec('DELETE FROM js_user_groups_contact WHERE group_id = $1', [group.ug_id]);
      await exec('DELETE FROM js_user_groups WHERE ug_id = $1 AND ug_user_id = $2', [group.ug_id, user.u_id]);
    }
    if (e instanceof ImportError) return fail(e.message);
    throw e;
  }

  // Shown once by the contact list (Laravel ->with('import', …))
  (await cookies()).set('wa_import', JSON.stringify({ ...result, group: group?.up_group_name ?? null }), {
    path: '/', maxAge: 120, sameSite: 'lax', httpOnly: false,
  });
  redirect(group ? `/contacts?group=${group.ug_id}` : '/contacts');
}
