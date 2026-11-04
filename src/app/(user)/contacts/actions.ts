'use server';

import type { PoolClient } from 'pg';
import { refresh } from 'next/cache';
import { fAll, fBool, fInt, flash, fStr, invalid, ok, type ActionResult } from '@/lib/actions';
import { requireUser } from '@/lib/auth';
import { exec, one, query, tx, value } from '@/lib/db';
import { normalizePhone } from '@/lib/phone';
import { filterWhere, type ContactFilter } from './filter';

/** Contacts: add / edit and bulk actions (User\ContactController store / update / bulk). */

interface ContactInput {
  name: string | null;
  mobile: string;
  groups: number[];
  optedOut: boolean;
}

async function validateContact(userId: number, fd: FormData, ignoreId: number | null): Promise<ContactInput | { errors: Record<string, string> }> {
  const rawMobile = fStr(fd, 'mobile');
  const mobile = normalizePhone(rawMobile) ?? rawMobile;
  const name = fStr(fd, 'name');
  const errors: Record<string, string> = {};
  if (Array.from(name).length > 250) errors.name = 'The name field must not be greater than 250 characters.';
  if (mobile === '') errors.mobile = 'The mobile field is required.';
  else if (!/^\d{10,15}$/.test(mobile)) errors.mobile = 'Enter a valid mobile number (10 digits, or with country code).';
  else if (ignoreId !== null && await value('SELECT 1 FROM js_user_contact_list WHERE cl_user_id = $1 AND cl_mobile_no = $2 AND cl_id <> $3 LIMIT 1', [userId, mobile, ignoreId])) {
    errors.mobile = 'Another contact already has this number.';
  }

  const raw = fAll(fd, 'groups[]');
  const groups = [...new Set(raw.map((v) => parseInt(v, 10)))];
  if (raw.length) {
    const owned = new Set((await query<{ ug_id: number }>(
      'SELECT ug_id FROM js_user_groups WHERE ug_user_id = $1 AND ug_id = ANY($2::int[])', [userId, groups.filter(Number.isFinite)],
    )).map((g) => g.ug_id));
    raw.forEach((v, i) => {
      if (!owned.has(parseInt(v, 10))) errors[`groups.${i}`] = `The selected groups.${i} is invalid.`;
    });
  }
  if (Object.keys(errors).length) return { errors };
  return { name: name || null, mobile, groups, optedOut: fBool(fd, 'opted_out') };
}

/** Group memberships = exactly `groups`; opt-out flag + block list. */
async function syncContact(db: PoolClient, userId: number, contact: { cl_id: number; cl_mobile_no: string; cl_name: string | null }, data: ContactInput) {
  await exec('DELETE FROM js_user_groups_contact WHERE contact_id = $1 AND NOT (group_id = ANY($2::int[]))', [contact.cl_id, data.groups], db);
  if (data.groups.length) {
    await exec(
      'INSERT INTO js_user_groups_contact (group_id, contact_id) SELECT unnest($2::int[]), $1 ON CONFLICT DO NOTHING',
      [contact.cl_id, data.groups], db,
    );
  }
  await setOptOut(db, `SELECT cl_id, cl_mobile_no, cl_name FROM js_user_contact_list c WHERE c.cl_id = $2 AND c.cl_user_id = $1`, [userId, contact.cl_id], data.optedOut);
}

/**
 * Opt-out lives on the contact (shown) and in the block list (checked by the
 * sender). `scope` selects cl_id, cl_mobile_no, cl_name with $1 = user id.
 * One statement, so every part sees the same set of contacts. Returns the
 * number of contacts whose flag changed.
 */
async function setOptOut(db: PoolClient, scope: string, params: unknown[], optOut: boolean): Promise<number> {
  const sql = optOut
    ? `WITH s AS (${scope}),
            changed AS (UPDATE js_user_contact_list SET cl_opt_out = 1 WHERE cl_id IN (SELECT cl_id FROM s) AND cl_opt_out <> 1 RETURNING 1),
            blocked AS (
              UPDATE js_user_block_list b SET ubl_name = NULLIF(left(btrim(s.cl_name), 100), ''), ubl_souce = 1, ubl_dstatus = 0
                FROM s WHERE b.ubl_user_id = $1 AND b.ubl_mobile_no = s.cl_mobile_no RETURNING 1),
            added AS (
              INSERT INTO js_user_block_list (ubl_user_id, ubl_mobile_no, ubl_name, ubl_souce, ubl_dstatus)
              SELECT $1, s.cl_mobile_no, NULLIF(left(btrim(s.cl_name), 100), ''), 1, 0 FROM s
               WHERE s.cl_mobile_no IS NOT NULL
                 AND NOT EXISTS (SELECT 1 FROM js_user_block_list b WHERE b.ubl_user_id = $1 AND b.ubl_mobile_no = s.cl_mobile_no)
              RETURNING 1)
       SELECT COUNT(*)::int FROM changed`
    : `WITH s AS (${scope}),
            changed AS (UPDATE js_user_contact_list SET cl_opt_out = 2 WHERE cl_id IN (SELECT cl_id FROM s) AND cl_opt_out = 1 RETURNING 1),
            unblocked AS (UPDATE js_user_block_list SET ubl_dstatus = 1 WHERE ubl_user_id = $1 AND ubl_mobile_no IN (SELECT cl_mobile_no FROM s) RETURNING 1)
       SELECT COUNT(*)::int FROM changed`;
  return (await value<number>(sql, params, db)) ?? 0;
}

export async function storeContact(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const data = await validateContact(user.u_id, fd, null);
  if ('errors' in data) return invalid(data.errors);

  const created = await tx(async (db) => {
    let contact = await one<{ cl_id: number; cl_mobile_no: string; cl_name: string | null }>(
      `INSERT INTO js_user_contact_list (cl_user_id, cl_mobile_no, cl_name) VALUES ($1, $2, $3)
       ON CONFLICT (cl_user_id, cl_mobile_no) DO NOTHING RETURNING cl_id, cl_mobile_no, cl_name`,
      [user.u_id, data.mobile, data.name], db,
    );
    const isNew = !!contact;
    if (!contact) {
      contact = await one('SELECT cl_id, cl_mobile_no, cl_name FROM js_user_contact_list WHERE cl_user_id = $1 AND cl_mobile_no = $2', [user.u_id, data.mobile], db);
      if (contact && data.name) await exec('UPDATE js_user_contact_list SET cl_name = $2 WHERE cl_id = $1', [contact.cl_id, data.name], db);
    }
    await syncContact(db, user.u_id, contact!, data);
    return isNew;
  });

  await flash('success', created ? 'Contact added.' : 'That number was already a contact; it has been updated.');
  refresh();
  return ok();
}

export async function updateContact(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = fInt(fd, 'id');
  const contact = await one<{ cl_id: number; cl_mobile_no: string; cl_name: string | null; cl_last_msg_id: number }>(
    'SELECT cl_id, cl_mobile_no, cl_name, cl_last_msg_id FROM js_user_contact_list WHERE cl_id = $1 AND cl_user_id = $2', [id, user.u_id],
  );
  if (!contact) return invalid({ mobile: 'Contact not found.' });
  const data = await validateContact(user.u_id, fd, contact.cl_id);
  if ('errors' in data) return invalid(data.errors);

  await tx(async (db) => {
    // The Inbox finds a conversation by number, so a contact with chat history keeps its number
    const mobile = contact.cl_last_msg_id > 0 ? contact.cl_mobile_no : data.mobile;
    await exec('UPDATE js_user_contact_list SET cl_name = $2, cl_mobile_no = $3 WHERE cl_id = $1', [contact.cl_id, data.name, mobile], db);
    await syncContact(db, user.u_id, { ...contact, cl_mobile_no: mobile, cl_name: data.name }, data);
  });

  await flash('success', 'Contact updated.');
  refresh();
  return ok();
}

const BULK_ACTIONS = ['add_group', 'remove_group', 'opt_out', 'opt_in', 'delete'] as const;
type BulkAction = (typeof BULK_ACTIONS)[number];

const BULK_MESSAGES: Record<BulkAction, string> = {
  add_group: '%d contact(s) added to the group.',
  remove_group: '%d contact(s) removed from the group.',
  opt_out: '%d contact(s) opted out — campaigns will skip them.',
  opt_in: '%d contact(s) opted back in.',
  delete: '%d contact(s) deleted.',
};

/**
 * Bulk actions on the ticked contacts, or on every contact matching the
 * filter (all=1). Set-based SQL instead of chunked loops.
 */
export async function bulkContacts(filter: ContactFilter, fd: FormData): Promise<void> {
  const user = await requireUser();
  const action = fStr(fd, 'action') as BulkAction;
  const all = fBool(fd, 'all');
  const ids = fAll(fd, 'ids[]');
  const groupRaw = fStr(fd, 'group_id');
  const groupId = parseInt(groupRaw, 10);

  const errors: string[] = [];
  if (!action) errors.push('The action field is required.');
  else if (!BULK_ACTIONS.includes(action)) errors.push('The selected action is invalid.');
  if (!all && !ids.length) errors.push('Select at least one contact.');
  if (!all && ids.some((v) => !/^-?\d+$/.test(v))) errors.push('The ids field must be an array of integers.');
  const needsGroup = action === 'add_group' || action === 'remove_group';
  if (needsGroup && groupRaw === '') errors.push('Choose a group.');
  else if (groupRaw !== '' && !(await value('SELECT 1 FROM js_user_groups WHERE ug_id = $1 AND ug_user_id = $2', [Number.isFinite(groupId) ? groupId : 0, user.u_id]))) {
    errors.push('The selected group id is invalid.');
  }
  if (errors.length) {
    await flash('error', errors.join('\n'));
    refresh();
    return;
  }

  // $1 = user id in every scope
  const params: unknown[] = [];
  const scopeWhere = all ? filterWhere(user.u_id, filter, params) : (params.push(user.u_id, ids.map(Number)), 'c.cl_user_id = $1 AND c.cl_id = ANY($2::int[])');
  const scope = `SELECT c.cl_id, c.cl_mobile_no, c.cl_name, c.cl_last_msg_id FROM js_user_contact_list c WHERE ${scopeWhere}`;
  const g = `$${params.length + 1}`;

  const count = await tx(async (db) => {
    switch (action) {
      case 'add_group':
        return exec(`INSERT INTO js_user_groups_contact (group_id, contact_id) SELECT ${g}::int, s.cl_id FROM (${scope}) s ON CONFLICT DO NOTHING`, [...params, groupId], db);
      case 'remove_group':
        return exec(`DELETE FROM js_user_groups_contact WHERE group_id = ${g} AND contact_id IN (SELECT cl_id FROM (${scope}) s)`, [...params, groupId], db);
      case 'opt_out':
      case 'opt_in':
        return setOptOut(db, scope, params, action === 'opt_out');
      case 'delete':
        // Contacts with chat history keep their row for the Inbox; they only leave their groups
        return (await value<number>(
          `WITH s AS (${scope}),
                ungrouped AS (DELETE FROM js_user_groups_contact WHERE contact_id IN (SELECT cl_id FROM s) RETURNING 1),
                deleted AS (DELETE FROM js_user_contact_list WHERE cl_id IN (SELECT cl_id FROM s WHERE cl_last_msg_id = 0) RETURNING 1)
           SELECT ((SELECT COUNT(*) FROM deleted) + (SELECT COUNT(*) FROM s WHERE cl_last_msg_id > 0))::int`,
          params, db,
        )) ?? 0;
    }
  });

  await flash('success', BULK_MESSAGES[action].replace('%d', String(count))
    + (action === 'delete' ? ' Contacts with chat history stay in the Inbox but are removed from all groups.' : ''));
  refresh();
}
