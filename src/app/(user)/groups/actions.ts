'use server';

import { refresh } from 'next/cache';
import { fInt, flash, fStr, invalid, ok, type ActionResult } from '@/lib/actions';
import { requireUser } from '@/lib/auth';
import { exec, one, tx, value } from '@/lib/db';
import { now } from '@/lib/time';

/** Contact groups (User\GroupController store / update / destroy). */

async function validateName(userId: number, fd: FormData, ignoreId = 0): Promise<{ name: string } | { errors: Record<string, string> }> {
  const name = fStr(fd, 'name');
  if (name === '') return { errors: { name: 'The name field is required.' } };
  if (Array.from(name).length > 100) return { errors: { name: 'The name field must not be greater than 100 characters.' } };
  // up_group_name is citext → case-insensitive like the MySQL unique rule
  const taken = await value('SELECT 1 FROM js_user_groups WHERE ug_user_id = $1 AND up_group_name = $2 AND ug_id <> $3 LIMIT 1', [userId, name, ignoreId]);
  if (taken) return { errors: { name: 'You already have a group with this name.' } };
  return { name };
}

export async function createGroup(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const v = await validateName(user.u_id, fd);
  if ('errors' in v) return invalid(v.errors);
  const g = await one<{ up_group_name: string }>(
    'INSERT INTO js_user_groups (ug_user_id, up_group_name, ug_updated_on) VALUES ($1, $2, $3) RETURNING up_group_name',
    [user.u_id, v.name, now()],
  );
  await flash('success', `Group “${g!.up_group_name}” created.`);
  refresh();
  return ok();
}

export async function renameGroup(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = fInt(fd, 'id');
  const exists = await value('SELECT 1 FROM js_user_groups WHERE ug_id = $1 AND ug_user_id = $2 AND ug_dstatus = 0', [id, user.u_id]);
  if (!exists) return invalid({ name: 'Group not found.' });
  const v = await validateName(user.u_id, fd, id);
  if ('errors' in v) return invalid(v.errors);
  await exec('UPDATE js_user_groups SET up_group_name = $3, ug_updated_on = $4 WHERE ug_id = $1 AND ug_user_id = $2', [id, user.u_id, v.name, now()]);
  await flash('success', 'Group renamed.');
  refresh();
  return ok();
}

/** Removes the group and its memberships; the contacts themselves stay. */
export async function deleteGroup(id: number): Promise<void> {
  const user = await requireUser();
  const name = await tx(async (db) => {
    const g = await one<{ up_group_name: string }>(
      'DELETE FROM js_user_groups WHERE ug_id = $1 AND ug_user_id = $2 AND ug_dstatus = 0 RETURNING up_group_name', [id, user.u_id], db,
    );
    if (g) await exec('DELETE FROM js_user_groups_contact WHERE group_id = $1', [id], db);
    return g?.up_group_name ?? null;
  });
  if (name === null) await flash('error', 'Group not found.');
  else await flash('success', `Group “${name}” deleted. Its contacts are still in Contacts.`);
  refresh();
}
