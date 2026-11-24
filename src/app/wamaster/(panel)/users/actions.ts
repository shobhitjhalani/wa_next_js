'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { fail, fAll, fBool, flash, fRaw, fStr, invalid, isEmail, ok, type ActionResult } from '@/lib/actions';
import { categoriesValue } from '@/lib/template-categories';
import { changes, logActivity } from '@/lib/activity';
import { requireRight, requireUserRight, userModule, type Right } from '@/lib/admin-access';
import { exec, insert, one, tx, update, value } from '@/lib/db';
import { requireAdminCan } from '@/lib/auth';
import { validExpiryHours } from '@/lib/services/settings';
import { hashPassword } from '@/lib/password';
import { metaGet, registerNumber, subscribeApp } from '@/lib/services/meta';
import { findPlan, recharge } from '@/lib/services/plans';
import { syncTemplates } from '@/lib/services/templates';
import { randomString } from '@/lib/text';
import { addDays, now, phpDate } from '@/lib/time';
import { USER_TYPE, type UserRow } from '@/lib/types';
import { FLAGS, WA_FLAG_FIELDS } from './flags';

/**
 * Server Actions for /wamaster/users (Admin\UserController). Every action re-checks the admin session
 * and the member's right on that user (src/lib/admin-access.ts): users not assigned to them are not found.
 */

/** The signed-in member, after checking `right` on user `id`. */
async function staffFor(id: number, right: Right) {
  return (await requireUserRight(id, right)).access.admin;
}

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

/** "TPEM TATA (tpem_tata) #11" for the activity log. */
async function userLabel(id: number): Promise<string> {
  return (await value<string>(
    `SELECT COALESCE(NULLIF(u_company_name, ''), NULLIF(u_name, ''), u_username::text) || ' (' || COALESCE(u_username::text, '') || ') #' || u_id FROM js_user WHERE u_id = $1`, [id])) ?? `#${id}`;
}

const logUser = async (id: number, action: string, details?: string[], module = 'users') =>
  logActivity({ module, action, target: await userLabel(id), targetId: id, details });

/** Fields of a user shown in the activity log when they change. */
const USER_FIELDS: Record<string, string> = {
  u_name: 'Name', u_company_name: 'Company', u_company_gst_no: 'GSTIN', u_mobile_no: 'Mobile', u_email_id: 'Email', u_billing_email_id: 'Billing email',
  u_username: 'Username', u_password: 'Password', u_status: 'Status', u_parent_id: 'Parent account', u_assign_to: 'Assigned to',
  u_country: 'Country', u_state: 'State', u_balance: 'Previous balance', u_google_sheet_email: 'Google Sheet email',
  u_wa_no: 'WA number', u_wa_phone_id: 'Phone number ID', u_wa_b_id: 'WABA ID', u_business_id: 'Business ID', u_daily_limit: 'Daily limit',
  u_msg_limit: 'Template message limit', u_msg_used: 'Template messages used', u_template_categories: 'Template categories',
  u_wa_incoming_url: 'Incoming URL', u_wa_form_url: 'Flow Response URL', u_wa_catalogue_url: 'Catalogue Order URL', u_wa_app_url: 'App URL', u_ai_key: 'AI key',
  u_bot_flow: 'Chatbot Flows', u_crm: 'Leads CRM', u_bulk_post: 'Bulk Posting', u_team: 'Teams', u_ads: 'Ads Management',
  u_send_wa: 'Send Flow', u_wa_enable_catalogue: 'Catalogue', u_send_app: 'Forward to App URL', u_enable_ai: 'AI', u_wa_coexistence: 'Coexistence',
  u_own_account: 'Client manages own WABA', u_google_sheet: 'Google Sheet', u_wa_enable_incoming: 'Incoming Webhook', u_is_new_no: 'MM Lite',
};
const ON_OFF = new Set(['u_bot_flow', 'u_crm', 'u_bulk_post', 'u_team', 'u_ads', 'u_send_wa', 'u_wa_enable_catalogue', 'u_send_app', 'u_enable_ai',
  'u_wa_coexistence', 'u_own_account', 'u_google_sheet', 'u_wa_enable_incoming', 'u_is_new_no']);
const userValue = (k: string, v: unknown): string => {
  if (ON_OFF.has(k)) return Number(v) === 1 ? 'On' : 'Off';
  if (k === 'u_status') return Number(v) === 1 ? 'Active' : Number(v) === 2 ? 'Inactive' : String(v ?? '—');
  if (k === 'u_msg_limit') return Number(v) ? String(v) : 'Unlimited';
  if (k === 'u_template_categories') return v ? String(v) : 'All';
  return v === null || v === undefined || v === '' ? '—' : String(v);
};

// ------------------------------------------------------------------ add / edit

/** store() when id = 0, update() otherwise (UserController::save). */
export async function saveUser(id: number, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const access = id ? (await requireUserRight(id, 'edit')).access : null;
  const existing = id ? await aliveUser(id) : null;
  if (id && !existing) return fail('User not found.');
  const utRaw = fStr(fd, 'ut');
  const type = existing ? Number(existing.u_type) : (utRaw === '' ? USER_TYPE.WHATSAPP : parseInt(utRaw, 10) || 0);
  const acc = access ?? await requireRight(userModule(type), 'add');
  const me = acc.admin;
  // A member who only sees their own users can't hand a user to someone else
  if (!acc.seesAll(type)) fd.set('assign_to', String(me.emp_id));

  // Only fields present in the form are validated and saved (like $request->validate()).
  const errors: Record<string, string> = {};
  const data: Record<string, string | null> = {};
  // Template message limit: "Unlimited" is stored as 0; "Limited" needs at least 1
  const limitType = fStr(fd, 'msg_limit_type');
  if (limitType === 'unlimited') fd.set('msg_limit', '0');
  else if (limitType === 'limited') {
    const raw = fStr(fd, 'msg_limit');
    if (raw === '') errors.msg_limit = 'Enter how many template messages this user may send.';
    else if (/^\d+$/.test(raw) && parseInt(raw, 10) < 1) errors.msg_limit = 'The template message limit must be at least 1.';
  }
  // Allowed template categories: all ticked = no restriction (stored as NULL)
  const categoriesPosted = type === USER_TYPE.WHATSAPP && fd.has('template_categories_form');
  const categories = fAll(fd, 'template_categories');
  if (categoriesPosted && !categories.length) errors.template_categories = 'Choose at least one template category.';
  for (const [key, rule] of Object.entries(USER_RULES)) {
    if (!fd.has(key) && !rule.required) continue;
    const v = fStr(fd, key);
    const msg = check(key, v, rule);
    if (msg) errors[key] ??= msg;
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
  // Switches not on the WhatsApp form (Incoming Webhook, Google Sheet: unused) keep their stored value
  const NOT_ON_WA_FORM = new Set<string>(['wa_enable_incoming', 'google_sheet']);
  for (const flag of FLAGS) {
    if (type === USER_TYPE.WHATSAPP && NOT_ON_WA_FORM.has(flag)) continue;
    values[`u_${flag}`] = fBool(fd, flag) ? 1 : 2;
  }
  if (type === USER_TYPE.WHATSAPP) {
    // MM Lite (marketing) is always on for WhatsApp users
    values.u_is_new_no = 1;
    if (categoriesPosted) values.u_template_categories = categoriesValue(categories);
    // A switched-off option keeps no URL / key, so nothing is forwarded or used for it
    for (const [flag, field] of Object.entries(WA_FLAG_FIELDS)) if (values[`u_${flag}`] !== 1) values[`u_${field}`] = null;
  }
  // Sub-accounts inherit "own account" from their parent
  if (type === USER_TYPE.WHATSAPP && values.u_parent_id) {
    values.u_own_account = Number(await value<number>('SELECT u_own_account FROM js_user WHERE u_id = $1', [values.u_parent_id])) || 2;
  }
  const defaults: Record<string, number> = { u_status: 2, u_balance: 0, u_daily_limit: 0, u_msg_limit: 0, u_parent_id: 0, u_country: 4, u_state: 0, u_assign_to: 0 };
  // Editing: a field the form does not show (WhatsApp users have no Country / State / Previous Balance) keeps its value
  for (const [col, def] of Object.entries(defaults)) if (!existing || fd.has(col.slice(2))) values[col] ??= def;
  if (values.u_status !== null) values.u_status = Number(values.u_status);
  if (password.trim() !== '') values.u_password = await hashPassword(password);
  if (existing && fBool(fd, 'msg_used_reset')) values.u_msg_used = 0;
  values.u_updated_on = now();
  values.u_updated_by = me.emp_id;

  if (existing) {
    const before = await one<Record<string, unknown>>('SELECT * FROM js_user WHERE u_id = $1', [id]);
    await update('js_user', values, 'u_id = $1', [id]);
    const diff = changes(before, values, USER_FIELDS, userValue);
    await logUser(id, 'Updated user', diff.length ? diff : ['No field changed']);
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
  await logUser(newId, `Added ${type === USER_TYPE.WHATSAPP ? 'WhatsApp' : 'Corporate'} user`,
    changes({}, values, USER_FIELDS, userValue).filter((d) => !/ → —$/.test(d)));
  await flash('success', 'User Successfully Added');
  redirect(showPath(newId));
}

// ------------------------------------------------------------------ list actions

export async function toggleUserStatus(id: number): Promise<void> {
  await staffFor(id, 'edit');
  const st = await value<number>('UPDATE js_user SET u_status = CASE WHEN u_status = 1 THEN 2 ELSE 1 END WHERE u_id = $1 AND u_dstatus = 0 RETURNING u_status', [id]);
  if (st !== null) {
    await logUser(id, st === 1 ? 'Activated user' : 'Deactivated user', [`Status: ${st === 1 ? 'Inactive → Active' : 'Active → Inactive'}`]);
    await flash('success', 'Record Successfully Updated');
  }
  revalidatePath('/wamaster/users');
  revalidatePath(showPath(id));
}

export async function destroyUser(id: number): Promise<void> {
  await staffFor(id, 'delete');
  const type = await value<number>('UPDATE js_user SET u_dstatus = 1 WHERE u_id = $1 AND u_dstatus = 0 RETURNING u_type', [id]);
  if (type === null) {
    await flash('error', 'User not found.');
    revalidatePath('/wamaster/users');
    return;
  }
  await logUser(id, 'Deleted user');
  await flash('success', 'Record Successfully Deleted');
  redirect(`/wamaster/users?ut=${type}`);
}

// ------------------------------------------------------------------ WhatsApp account

/** Manual recharge by staff (User::fun_recharge). */
export async function rechargeUser(id: number, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const me = await staffFor(id, 'edit');
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
  // A custom plan can only be used for the user it was made for
  if (!plan || (Number(plan.mv_user_id ?? 0) > 0 && Number(plan.mv_user_id) !== id)) return fail('Plan not found.');

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
  await logUser(id, 'Recharged user', [
    `Plan: ${plan.mv_name ?? `#${plan.mv_id}`}`,
    `Amount received: ${Number(fStr(fd, 'payment_amount') || 0)}`, `Payment received: ${fBool(fd, 'payment_received') ? 'Yes' : 'No'}`,
    ...(fStr(fd, 'payment_ref_no') ? [`Reference: ${fStr(fd, 'payment_ref_no')}`] : []), ...(fStr(fd, 'remark') ? [`Remark: ${fStr(fd, 'remark')}`] : []),
    `Valid till ${phpDate('d-m-Y', Number(row.ur_valid_till))}`,
  ], 'recharge');
  await flash('success', 'Recharge Successfully Done. Valid till ' + phpDate('d-m-Y', Number(row.ur_valid_till)));
  revalidatePath(showPath(id));
  return ok();
}

export async function syncUserTemplates(id: number): Promise<void> {
  await staffFor(id, 'edit');
  const user = await aliveUser(id);
  if (!user) return;
  const count = await syncTemplates(user);
  await logUser(id, 'Synced WhatsApp templates', [count === null ? 'Failed: Meta did not answer' : `${count} templates`]);
  await flash(count === null ? 'error' : 'success', count === null ? 'Unable to fetch templates from WhatsApp.' : `${count} templates synced.`);
  revalidatePath(showPath(id));
}

export async function registerUserNumber(id: number): Promise<void> {
  await staffFor(id, 'edit');
  const user = await aliveUser(id);
  if (!user) return;
  if (!user.u_wa_phone_id || !user.u_wa_b_id) {
    await flash('error', 'Set the Phone Number ID and WABA ID first.');
    revalidatePath(showPath(id));
    return;
  }

  // 1. Register the number for the Cloud API. WhatsApp Business app numbers (coexistence / SMB) are
  //    already registered through the app: Meta refuses with "not available for SMB businesses".
  const reg = await registerNumber(user);
  const regMsg = String(reg.error?.message ?? '');
  const smb = !!reg.error && /\bSMB\b|business app|coexist/i.test(regMsg);

  // 2. Subscribe our app to the WABA: this is what makes Meta send the number's webhooks (messages, statuses).
  const sub = await subscribeApp(user);
  // 3. Confirm with Meta that the app is now on the WABA's subscribed apps.
  const subs = sub.error ? null : await metaGet(`${user.u_wa_b_id}/subscribed_apps`);
  const subscribedApps = Array.isArray(subs?.data) ? subs.data.length : 0;
  const hookOk = !sub.error && subscribedApps > 0;
  const hook = sub.error
    ? `Webhook subscription failed: ${sub.error.message ?? 'unknown error'}`
    : hookOk ? 'Webhook is active (app subscribed to the WABA).' : 'Meta accepted the subscription but lists no subscribed app yet; try again in a minute.';

  const register = !reg.error
    ? 'Number registered.'
    : smb ? 'This is a WhatsApp Business app (coexistence) number, so it does not need registering.'
      : `Register failed: ${regMsg || 'unknown error'}.`;
  await logUser(id, 'Registered number / webhook', [register, hook]);
  await flash(hookOk && (!reg.error || smb) ? 'success' : 'error', `${register} ${hook}`);
  revalidatePath(showPath(id));
}

// ------------------------------------------------------------------ Google-sheet emails, sheets, extractor keys

export async function addEmail(id: number, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const me = await staffFor(id, 'edit');
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
  await logUser(id, 'Added Google Sheet email', [email.toLowerCase(), `Sheet limit: ${limitRaw || 'unlimited'}`]);
  await flash('success', 'Email added');
  revalidatePath(showPath(id));
  return ok();
}

export async function toggleEmail(id: number, emailId: number): Promise<void> {
  await staffFor(id, 'edit');
  const em = await one<{ ue_email_id: string; ue_status: number }>('UPDATE js_user_emails SET ue_status = CASE WHEN ue_status = 1 THEN 2 ELSE 1 END WHERE ue_id = $2 AND ue_user_id = $1 RETURNING ue_email_id, ue_status', [id, emailId]);
  if (em) {
    await logUser(id, `${em.ue_status === 1 ? 'Enabled' : 'Disabled'} Google Sheet email`, [em.ue_email_id]);
    await flash('success', 'Record Successfully Updated');
  }
  revalidatePath(showPath(id));
}

export async function deleteEmail(id: number, emailId: number): Promise<void> {
  await staffFor(id, 'edit');
  const gone = await value<string>('DELETE FROM js_user_emails WHERE ue_id = $2 AND ue_user_id = $1 RETURNING ue_email_id', [id, emailId]);
  if (gone) await logUser(id, 'Deleted Google Sheet email', [gone]);
  await flash('success', 'Record Successfully Deleted');
  revalidatePath(showPath(id));
}

export async function toggleSheet(id: number, sheetId: number): Promise<void> {
  await staffFor(id, 'edit');
  const n = await exec(
    'UPDATE js_user_active_sheets SET us_status = CASE WHEN us_status = 1 THEN 2 ELSE 1 END, us_updated_on = $3 WHERE us_id = $2 AND us_user_id = $1',
    [id, sheetId, now()]);
  if (n) {
    await logUser(id, 'Switched a Google Sheet on / off', [`Sheet #${sheetId}`]);
    await flash('success', 'Record Successfully Updated');
  }
  revalidatePath(showPath(id));
}

export async function deleteSheet(id: number, sheetId: number): Promise<void> {
  await staffFor(id, 'edit');
  await exec('UPDATE js_user_active_sheets SET us_status = 2, us_dstatus = 1 WHERE us_id = $2 AND us_user_id = $1', [id, sheetId]);
  await logUser(id, 'Deleted Google Sheet', [`Sheet #${sheetId}`]);
  await flash('success', 'Record Successfully Deleted');
  revalidatePath(showPath(id));
}

export async function generateKey(id: number): Promise<void> {
  const me = await staffFor(id, 'edit');
  if (!(await aliveUser(id))) return;
  await insert('js_user_data_extractor_keys', {
    dek_user_id: id,
    dek_key: accessKey(),
    dek_valid_till: addDays(now(), 365),
    dek_created_on: now(),
    dek_created_by: me.emp_id,
  }, 'dek_id');
  await logUser(id, 'Generated data extractor key');
  await flash('success', 'Key generated');
  revalidatePath(showPath(id));
}

export async function logoutKey(id: number, keyId: number): Promise<void> {
  await staffFor(id, 'edit');
  await exec('UPDATE js_user_data_extractor_keys SET dek_is_login = 0, dek_last_login = 0 WHERE dek_id = $2 AND dek_user_id = $1', [id, keyId]);
  await logUser(id, 'Logged out data extractor key', [`Key #${keyId}`]);
  await flash('success', 'Key logged out');
  revalidatePath(showPath(id));
}

export async function deleteKey(id: number, keyId: number): Promise<void> {
  await staffFor(id, 'edit');
  await exec('UPDATE js_user_data_extractor_keys SET dek_dstatus = 1 WHERE dek_id = $2 AND dek_user_id = $1', [id, keyId]);
  await logUser(id, 'Deleted data extractor key', [`Key #${keyId}`]);
  await flash('success', 'Key deleted');
  revalidatePath(showPath(id));
}

/** Message expiry hours of one account (super admin only); empty = the default in Settings → Sending Limits. */
export async function saveMsgExpiry(id: number, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireAdminCan('super');
  const raw = fStr(fd, 'msg_expiry_hours').trim();
  const hours = raw === '' ? null : Number(raw);
  if (hours !== null) {
    const error = validExpiryHours(hours);
    if (error) return invalid({ msg_expiry_hours: error });
  }
  const before = await one<{ h: number | null }>('SELECT u_msg_expiry_hours AS h FROM js_user WHERE u_id = $1 AND u_dstatus = 0', [id]);
  if (!before) return fail('User not found.');
  await exec('UPDATE js_user SET u_msg_expiry_hours = $2 WHERE u_id = $1', [id, hours]);
  const label = (h: number | null) => (h ? `${h} h` : 'Default');
  if ((before.h ?? null) !== hours) await logUser(id, 'Changed message expiry', [`Message expiry: ${label(before.h)} → ${label(hours)}`]);
  revalidatePath(showPath(id));
  return ok(hours ? `Messages of this user now expire after ${hours} hours.` : 'This user now uses the default message expiry.');
}
