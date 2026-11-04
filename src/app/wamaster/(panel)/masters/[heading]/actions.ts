'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { flash, fRaw, invalid, type ActionResult } from '@/lib/actions';
import { requireAdminCan } from '@/lib/auth';
import { exec, insert, one, update } from '@/lib/db';
import { now } from '@/lib/time';
import { randomString } from '@/lib/text';
import { MASTER_COLUMNS, masterFields } from './_lib';

const attr = (key: string) => key.replace(/_/g, ' ');
const isInt = (v: string) => /^[+-]?\d+$/.test(v) && Math.abs(Number(v)) <= 2147483647;
const isNumeric = (v: string) => /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(v);

/** Str::slug (ASCII subset). */
function slug(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/@/g, '-at-').replace(/[^a-z0-9\s_-]+/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Store / update a master value (MasterController::save). */
export async function saveMaster(heading: number, id: number | null, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireAdminCan('masters');
  if (!Number.isInteger(heading) || (id !== null && !Number.isInteger(id))) notFound();
  const head = await one<{ mh_id: number }>('SELECT mh_id FROM js_master_heading WHERE mh_id = $1', [heading]);
  if (!head) notFound();
  const existing = id
    ? await one<{ mv_id: number; mv_code: string | null; mv_name: string | null; mv_url_slug: string | null }>(
      'SELECT mv_id, mv_code, mv_name, mv_url_slug FROM js_master_value WHERE mv_id = $1 AND mv_type = $2 AND mv_dstatus = 0', [id, heading])
    : null;
  if (id && !existing) notFound();

  const errors: Record<string, string> = {};
  const status = fRaw(fd, 'status').trim();
  if (status === '') errors.status = 'The status field is required.';
  else if (!['1', '2'].includes(status)) errors.status = 'The selected status is invalid.';

  const data: Record<string, string | number | null> = {};
  for (const [key, , kind] of masterFields(heading)) {
    if (!MASTER_COLUMNS.includes(key)) continue;
    const present = fd.has(key);
    const raw = fRaw(fd, key).trim();
    const v = raw === '' ? null : raw;
    if (kind === 'number') {
      if (v !== null && !isInt(v)) errors[key] = `The ${attr(key)} field must be an integer.`;
    } else if (kind === 'decimal') {
      if (v !== null && !isNumeric(v)) errors[key] = `The ${attr(key)} field must be a number.`;
      else if (v !== null && Number(v) < 0) errors[key] = `The ${attr(key)} field must be at least 0.`;
    } else if (kind === 'plan_type') {
      if (v === null) errors[key] = `The ${attr(key)} field is required.`;
      else if (!['1', '2', '3'].includes(v)) errors[key] = `The selected ${attr(key)} is invalid.`;
    } else if (key === 'name') {
      if (v === null) errors[key] = `The ${attr(key)} field is required.`;
      else if (Array.from(v).length > 255) errors[key] = `The ${attr(key)} field must not be greater than 255 characters.`;
    }
    // Laravel only kept validated keys that were sent
    if (present || v !== null) data['mv_' + key] = v ?? (key === 'value' ? '' : null);
  }
  if (Object.keys(errors).length) return invalid(errors);

  if (data.mv_display_order !== undefined) data.mv_display_order = data.mv_display_order === null ? 1 : Number(data.mv_display_order);
  if (data.mv_value_decimal !== undefined) data.mv_value_decimal = data.mv_value_decimal === null ? 0 : Number(data.mv_value_decimal);

  const row: Record<string, unknown> = { ...data, mv_status: Number(status), mv_updated_on: now() };
  if (!existing?.mv_url_slug) {
    const code = (data.mv_code !== undefined ? data.mv_code : existing?.mv_code) as string | null;
    const name = (data.mv_name !== undefined ? data.mv_name : existing?.mv_name) as string | null;
    row.mv_url_slug = slug(`${code || name || ''}-${randomString(4)}`);
  }

  if (existing) {
    await update('js_master_value', row, 'mv_id = $1 AND mv_type = $2 AND mv_dstatus = 0', [existing.mv_id, heading]);
  } else {
    await insert('js_master_value', { mv_type: heading, mv_value: '', ...row }, 'mv_id');
  }

  await flash('success', 'Record Successfully Saved');
  redirect(`/wamaster/masters/${heading}`);
}

/** Soft-delete a master value (MasterController::destroy). */
export async function deleteMaster(heading: number, id: number): Promise<void> {
  await requireAdminCan('masters');
  if (!Number.isInteger(heading) || !Number.isInteger(id)) notFound();
  await exec('UPDATE js_master_value SET mv_dstatus = 1 WHERE mv_id = $1 AND mv_type = $2 AND mv_dstatus = 0', [id, heading]);
  await flash('success', 'Record Successfully Deleted');
  revalidatePath(`/wamaster/masters/${heading}`);
}
