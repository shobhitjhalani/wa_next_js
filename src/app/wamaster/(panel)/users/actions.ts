'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { fail, fBool, flash, fRaw, fStr, invalid, isEmail, ok, type ActionResult } from '@/lib/actions';
import { requireAdmin } from '@/lib/auth';
import { exec, insert, one, tx, update, value } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { registerNumber, subscribeApp } from '@/lib/services/meta';
import { findPlan, recharge } from '@/lib/services/plans';
import { syncTemplates } from '@/lib/services/templates';
import { randomString } from '@/lib/text';
import { addDays, now, phpDate } from '@/lib/time';
import { USER_TYPE, type UserRow } from '@/lib/types';
import { FLAGS } from './flags';

/** Server Actions for /wamaster/users (Admin\UserController). Every action re-checks the admin session. */

// ------------------------------------------------------------------ validation (Laravel default messages)

interface Rule {
  required?: boolean;
  max?: number;
  email?: boolean;
  integer?: boolean;
  numeric?: boolean;
  min?: number;
  url?: boolean;
  in?: string[];
}

const attr = (key: string) => key.replace(/_/g, ' ');
const chars = (s: string) => Array.from(s).length;
const isUrl = (s: string) => {
  if (!/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(s)) return false;
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
};

/** First failing rule's message, or null. Empty values pass unless required (Laravel "nullable"). */
function check(key: string, v: string, r: Rule): string | null {
  const a = attr(key);
  if (v === '') return r.required ? `The ${a} field is required.` : null;
  if (r.integer && !/^[+-]?\d+$/.test(v)) return `The ${a} field must be an integer.`;
  if (r.numeric && !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(v)) return `The ${a} field must be a number.`;
  if ((r.integer || r.numeric) && r.min !== undefined && Number(v) < r.min) return `The ${a} field must be at least ${r.min}.`;
  if (!r.integer && !r.numeric && r.min !== undefined && chars(v) < r.min) return `The ${a} field must be at least ${r.min} characters.`;
  if (r.email && !isEmail(v)) return `The ${a} field must be a valid email address.`;
  if (r.url && !isUrl(v)) return `The ${a} field must be a valid URL.`;
  if (r.max !== undefined && chars(v) > r.max) return `The ${a} field must not be greater than ${r.max} characters.`;
  if (r.in && !r.in.includes(v)) return `The selected ${a} is invalid.`;
  return null;
}

const USER_RULES: Record<string, Rule> = {
  name: { required: true, max: 200 },
  company_name: { max: 255 },
  company_gst_no: { max: 50 },
  mobile_no: { max: 25 },
  email_id: { email: true, max: 255 },
  billing_email_id: { email: true, max: 255 },
  username: { required: true, max: 255 },
  parent_id: { integer: true },
  country: { integer: true },
  state: { integer: true },
  assign_to: { integer: true },
  status: { in: ['1', '2'] },
  balance: { integer: true },
  daily_limit: { integer: true, min: 0 },
  msg_limit: { integer: true, min: 0 },
  wa_no: { max: 200 },
  wa_phone_id: { max: 255 },
  wa_b_id: { max: 255 },
  business_id: { max: 50 },
  wa_incoming_url: { url: true, max: 255 },
  wa_catalogue_url: { url: true, max: 255 },
  wa_form_url: { url: true, max: 255 },
  wa_app_url: { url: true, max: 255 },
  api_url: { max: 255 },
  ai_key: { max: 255 },
  google_sheet_email: { email: true },
};

const accessKey = () => Array.from({ length: 5 }, () => randomString(5).toUpperCase()).join('-');

async function aliveUser(id: number) {
  return one<Pick<UserRow, 'u_id' | 'u_type' | 'u_wa_phone_id' | 'u_wa_b_id'>>(
    'SELECT u_id, u_type, u_wa_phone_id, u_wa_b_id FROM js_user WHERE u_id = $1 AND u_dstatus = 0', [id]);
}

const showPath = (id: number) => `/wamaster/users/${id}`;

// ------------------------------------------------------------------ add / edit

/** store() when id = 0, update() otherwise (UserController::save). */
export async function saveUser(id: number, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const me = await requireAdmin();
  const existing = id ? await aliveUser(id) : null;
  if (id && !existing) return fail('User not found.');
  const utRaw = fStr(fd, 'ut');
  const type = existing ? Number(existing.u_type) : (utRaw === '' ? USER_TYPE.WHATSAPP : parseInt(utRaw, 10) || 0);

  // Only fields present in the form are validated and saved (like $request->validate()).
  const errors: Record<string, string> = {};
  const data: Record<string, string | null> = {};
  for (const [key, rule] of Object.entries(USER_RULES)) {
    if (!fd.has(key) && !rule.required) continue;
    const v = fStr(fd, key);
    const msg = check(key, v, rule);
    if (msg) errors[key] = msg;
    data[key] = v === '' ? null : v;
  }
  const password = fRaw(fd, 'password');
  const pwMsg = check('password', password.trim() === '' ? '' : password, { required: !existing, min: 6 });
  if (pwMsg) errors.password = pwMsg;

  if (!errors.username && data.username) {
    const taken = await value<number>('SELECT 1 FROM js_user WHERE u_username = $1 AND u_dstatus = 0 AND u_id <> $2 LIMIT 1', [data.username, id]);
    if (taken) errors.username = 'The username has already been taken.';
  }
  if (!errors.google_sheet_email && data.google_sheet_email) {
    const taken = await value<number>('SELECT 1 FROM js_user WHERE u_google_sheet_email = $1 AND u_id <> $2 LIMIT 1', [data.google_sheet_email, id]);
    if (taken) errors.google_sheet_email = 'The google sheet email has already been taken.';
  }
  if (Object.keys(errors).length) return invalid(errors);

  const values: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(data)) {
    values[`u_${key}`] = v !== null && USER_RULES[key]?.integer ? parseInt(v, 10) : v;
  }
  for (const flag of FLAGS) values[`u_${flag}`] = fBool(fd, flag) ? 1 : 2;
  // Sub-accounts inherit "own account" from their parent
  if (type === USER_TYPE.WHATSAPP && values.u_parent_id) {
    values.u_own_account = Number(await value<number>('SELECT u_own_account FROM js_user WHERE u_id = $1', [values.u_parent_id])) || 2;
  }
  const defaults: Record<string, number> = { u_status: 2, u_balance: 0, u_daily_limit: 0, u_msg_limit: 0, u_parent_id: 0, u_country: 4, u_state: 0, u_assign_to: 0 };
  for (const [col, def] of Object.entries(defaults)) values[col] ??= def;
  if (values.u_status !== null) values.u_status = Number(values.u_status);
  if (password.trim() !== '') values.u_password = await hashPassword(password);
  values.u_updated_on = now();
  values.u_updated_by = me.emp_id;

  if (existing) {
    await update('js_user', values, 'u_id = $1', [id]);
    await flash('success', 'User Successfully Updated');
    redirect(showPath(id));
  }

  const newId = await tx(async (db) => {
    const row = await insert<{ u_id: number }>('js_user', { u_type: type, u_created_on: now(), u_created_by: me.emp_id, ...values }, 'u_id', db);
    // Legacy: user code U00001 and a 5x5 access key used by the API
    await exec('UPDATE js_user SET u_code = $2, u_access_code = $3 WHERE u_id = $1',
      [row.u_id, 'U' + String(row.u_id).padStart(5, '0'), accessKey()], db);
    return row.u_id;
  });
  await flash('success', 'User Successfully Added');
  redirect(showPath(newId));
}

// ------------------------------------------------------------------ list actions

export async function toggleUserStatus(id: number): Promise<void> {
  await requireAdmin();
  const n = await exec('UPDATE js_user SET u_status = CASE WHEN u_status = 1 THEN 2 ELSE 1 END WHERE u_id = $1 AND u_dstatus = 0', [id]);
  if (n) await flash('success', 'Record Successfully Updated');
  revalidatePath('/wamaster/users');
  revalidatePath(showPath(id));
}

export async function destroyUser(id: number): Promise<void> {
  await requireAdmin();
  const type = await value<number>('UPDATE js_user SET u_dstatus = 1 WHERE u_id = $1 AND u_dstatus = 0 RETURNING u_type', [id]);
  if (type === null) {
    await flash('error', 'User not found.');
    revalidatePath('/wamaster/users');
    return;
  }
  await flash('success', 'Record Successfully Deleted');
  redirect(`/wamaster/users?ut=${type}`);
}

// ------------------------------------------------------------------ WhatsApp account

/** Manual recharge by staff (User::fun_recharge). */
export async function rechargeUser(id: number, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const me = await requireAdmin();
  const rules: Record<string, Rule> = {
    plan_id: { required: true, integer: true },
    payment_amount: { numeric: true, min: 0 },
    payment_source: { integer: true },
    payment_ref_no: { max: 255 },
    remark: { max: 255 },
  };
  const errors: Record<string, string> = {};
  for (const [key, rule] of Object.entries(rules)) {
    const msg = check(key, fStr(fd, key), rule);
    if (msg) errors[key] = msg;
  }
  if (Object.keys(errors).length) return invalid(errors);

  const user = await aliveUser(id);
  if (!user) return fail('User not found.');
  const plan = await findPlan(parseInt(fStr(fd, 'plan_id'), 10));
  if (!plan) return fail('Plan not found.');

  const row = await recharge(id, plan, {
    received: Number(fStr(fd, 'payment_amount') || 0),
    source: parseInt(fStr(fd, 'payment_source') || '0', 10),
    refNo: fStr(fd, 'payment_ref_no') || null,
    invoice: fBool(fd, 'generate_invoice') ? 1 : 2,
    status: fBool(fd, 'payment_received') ? 1 : 2,
    remark: fStr(fd, 'remark') || null,
    createdBy: me.emp_id,
    fromEmployee: true,
  });
  await flash('success', 'Recharge Successfully Done. Valid till ' + phpDate('d-m-Y', Number(row.ur_valid_till)));
  revalidatePath(showPath(id));
  return ok();
}

export async function syncUserTemplates(id: number): Promise<void> {
  await requireAdmin();
  const user = await aliveUser(id);
  if (!user) return;
  const count = await syncTemplates(user);
  await flash(count === null ? 'error' : 'success', count === null ? 'Unable to fetch templates from WhatsApp.' : `${count} templates synced.`);
  revalidatePath(showPath(id));
}

export async function registerUserNumber(id: number): Promise<void> {
  await requireAdmin();
  const user = await aliveUser(id);
  if (!user) return;
  const res = await registerNumber(user);
  await subscribeApp(user);
  await flash(res.error ? 'error' : 'success', res.error
    ? 'Register failed: ' + (res.error.message ?? 'unknown error')
    : 'Number registered and app subscribed.');
  revalidatePath(showPath(id));
}

// ------------------------------------------------------------------ Google-sheet emails, sheets, extractor keys

export async function addEmail(id: number, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const me = await requireAdmin();
  const email = fStr(fd, 'email');
  const limitRaw = fStr(fd, 'sheet_limit');
  const errors: Record<string, string> = {};
  const emailMsg = check('email', email, { required: true, email: true });
  if (emailMsg) errors.email = emailMsg;
  else if (await value<number>('SELECT 1 FROM js_user_emails WHERE ue_email_id = $1 LIMIT 1', [email])) errors.email = 'The email has already been taken.';
  const limitMsg = check('sheet_limit', limitRaw, { integer: true, min: 0 });
  if (limitMsg) errors.sheet_limit = limitMsg;
  if (Object.keys(errors).length) {
    // The form sits in a card header: show the errors in the page alert, like Laravel's flash partial
    await flash('error', Object.values(errors).join('\n'));
    revalidatePath(showPath(id));
    return invalid(errors);
  }
  if (!(await aliveUser(id))) return fail('User not found.');

  await insert('js_user_emails', {
    ue_user_id: id,
    ue_email_id: email.toLowerCase(),
    ue_sheet_limit: limitRaw === '' ? 0 : parseInt(limitRaw, 10),
    ue_created_on: now(),
    ue_created_by: me.emp_id,
  }, 'ue_id');
  await flash('success', 'Email added');
  revalidatePath(showPath(id));
  return ok();
}

export async function toggleEmail(id: number, emailId: number): Promise<void> {
  await requireAdmin();
  const n = await exec('UPDATE js_user_emails SET ue_status = CASE WHEN ue_status = 1 THEN 2 ELSE 1 END WHERE ue_id = $2 AND ue_user_id = $1', [id, emailId]);
  if (n) await flash('success', 'Record Successfully Updated');
  revalidatePath(showPath(id));
}

export async function deleteEmail(id: number, emailId: number): Promise<void> {
  await requireAdmin();
  await exec('DELETE FROM js_user_emails WHERE ue_id = $2 AND ue_user_id = $1', [id, emailId]);
  await flash('success', 'Record Successfully Deleted');
  revalidatePath(showPath(id));
}

export async function toggleSheet(id: number, sheetId: number): Promise<void> {
  await requireAdmin();
  const n = await exec(
    'UPDATE js_user_active_sheets SET us_status = CASE WHEN us_status = 1 THEN 2 ELSE 1 END, us_updated_on = $3 WHERE us_id = $2 AND us_user_id = $1',
    [id, sheetId, now()]);
  if (n) await flash('success', 'Record Successfully Updated');
  revalidatePath(showPath(id));
}

export async function deleteSheet(id: number, sheetId: number): Promise<void> {
  await requireAdmin();
  await exec('UPDATE js_user_active_sheets SET us_status = 2, us_dstatus = 1 WHERE us_id = $2 AND us_user_id = $1', [id, sheetId]);
  await flash('success', 'Record Successfully Deleted');
  revalidatePath(showPath(id));
}

export async function generateKey(id: number): Promise<void> {
  const me = await requireAdmin();
  if (!(await aliveUser(id))) return;
  await insert('js_user_data_extractor_keys', {
    dek_user_id: id,
    dek_key: accessKey(),
    dek_valid_till: addDays(now(), 365),
    dek_created_on: now(),
    dek_created_by: me.emp_id,
  }, 'dek_id');
  await flash('success', 'Key generated');
  revalidatePath(showPath(id));
}

export async function logoutKey(id: number, keyId: number): Promise<void> {
  await requireAdmin();
  await exec('UPDATE js_user_data_extractor_keys SET dek_is_login = 0, dek_last_login = 0 WHERE dek_id = $2 AND dek_user_id = $1', [id, keyId]);
  await flash('success', 'Key logged out');
  revalidatePath(showPath(id));
}

export async function deleteKey(id: number, keyId: number): Promise<void> {
  await requireAdmin();
  await exec('UPDATE js_user_data_extractor_keys SET dek_dstatus = 1 WHERE dek_id = $2 AND dek_user_id = $1', [id, keyId]);
  await flash('success', 'Key deleted');
  revalidatePath(showPath(id));
}
