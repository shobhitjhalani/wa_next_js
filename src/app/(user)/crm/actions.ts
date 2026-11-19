'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { fail, flash, fStr, fRaw, fInt, invalid, isEmail, ok, type ActionResult } from '@/lib/actions';
import { requireCrmUser } from '@/lib/auth';
import { CRM_LIMITS, FOLLOWUP_TYPES, isBuiltInSource, LEAD_SOURCES, LEAD_STATUS, MAX_CUSTOM_SOURCES, MAX_SOURCE_NAME, OPEN_STATUSES, REMIND_BEFORE, STATUS_INFO } from '@/lib/crm';
import { exec, insert, one, tx } from '@/lib/db';
import { normalizePhone } from '@/lib/phone';
import { connectFacebookPage, crmSettings, customSources, saveLead } from '@/lib/services/crm';
import { randomString } from '@/lib/text';
import { now, parseDate, phpDate } from '@/lib/time';

/** "2026-11-21T15:30" from the form → unix time; '' → 0. Problems go into errors[field]. */
function followupTime(fd: FormData, field: string, errors: Record<string, string>): number {
  const raw = fStr(fd, field);
  if (!raw) return 0;
  const t = parseDate(raw);
  if (!t) { errors[field] = 'Enter a valid date and time.'; return 0; }
  if (t < now() - 300) errors[field] = 'The next follow-up must be in the future.';
  return t;
}

/** Add a lead by hand, or edit one (ld_id set). */
export async function saveLeadAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireCrmUser();
  const id = fInt(fd, 'ld_id');
  const name = fStr(fd, 'name').slice(0, CRM_LIMITS.name);
  const rawMobile = fStr(fd, 'mobile');
  const email = fStr(fd, 'email').toLowerCase();
  const source = fStr(fd, 'source');
  const errors: Record<string, string> = {};
  const mobile = rawMobile ? normalizePhone(rawMobile) : '';
  if (!name && !rawMobile) errors.name = 'Enter the lead’s name or mobile number.';
  if (rawMobile && !mobile) errors.mobile = 'Enter a valid mobile number, e.g. 9876543210 or +44 7911 123456.';
  if (email && (!isEmail(email) || email.length > CRM_LIMITS.email)) errors.email = 'Enter a valid email address.';
  if (!LEAD_SOURCES.some((s) => s.value === source) && !(await customSources(user.u_id)).includes(source)) errors.source = 'Choose where the lead came from.';
  const next = id ? 0 : followupTime(fd, 'next_followup', errors);
  if (Object.keys(errors).length) return invalid(errors);
  const campaign = fStr(fd, 'campaign').slice(0, CRM_LIMITS.campaign);
  const notes = fRaw(fd, 'notes').trim().slice(0, CRM_LIMITS.notes);

  if (id) {
    const n = await exec(
      `UPDATE js_crm_lead SET ld_name = $3, ld_mobile = $4, ld_email = $5, ld_source = $6, ld_campaign = $7, ld_notes = $8, ld_updated_on = $9
        WHERE ld_id = $1 AND ld_user_id = $2`, [id, user.u_id, name, mobile ?? '', email, source, campaign, notes, now()]);
    if (!n) return fail('This lead no longer exists.');
    revalidatePath(`/crm/${id}`);
    return ok('Lead updated.');
  }
  const res = await saveLead(user.u_id, { name, mobile: mobile ?? '', email, source, campaign, notes, nextFollowup: next }, 'added by hand');
  if (res.duplicate) {
    await flash('success', 'This number already has an open lead, so the details were added to its history.');
  } else {
    await flash('success', 'Lead added.');
  }
  // The modal closes first, then the browser opens the lead (a server redirect would leave the modal backdrop behind)
  return ok(undefined, { id: res.id });
}

/** Log a follow-up: what happened, the new status and when to follow up next. */
export async function addFollowup(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireCrmUser();
  const id = fInt(fd, 'ld_id');
  const lead = await one<{ ld_status: number; ld_next_followup: number }>('SELECT ld_status, ld_next_followup FROM js_crm_lead WHERE ld_id = $1 AND ld_user_id = $2', [id, user.u_id]);
  if (!lead) return fail('This lead no longer exists.');

  const type = FOLLOWUP_TYPES.some((t) => t.value === fStr(fd, 'type')) ? fStr(fd, 'type') : 'note';
  const note = fRaw(fd, 'note').trim().slice(0, CRM_LIMITS.note);
  const status = fInt(fd, 'status');
  const errors: Record<string, string> = {};
  if (!STATUS_INFO[status]) errors.status = 'Choose the lead’s status.';
  const closed = !(OPEN_STATUSES as readonly number[]).includes(status);
  const next = closed ? 0 : followupTime(fd, 'next_followup', errors);
  if (!note && status === Number(lead.ld_status) && !next) errors.note = 'Write what happened, change the status or set the next follow-up.';
  if (Object.keys(errors).length) return invalid(errors);

  const t = now();
  await tx(async (db) => {
    await insert('js_crm_followup', {
      fu_lead_id: id, fu_user_id: user.u_id, fu_type: type, fu_note: note,
      fu_status: status === Number(lead.ld_status) ? 0 : status, fu_next_followup: next, fu_created_on: t,
    }, 'fu_id', db);
    await exec(
      `UPDATE js_crm_lead SET ld_status = $3, ld_next_followup = $4, ld_last_followup = $5, ld_updated_on = $5,
              ld_reminded_on = CASE WHEN $4 = ld_next_followup THEN ld_reminded_on ELSE 0 END
        WHERE ld_id = $1 AND ld_user_id = $2`, [id, user.u_id, status, next, t], db);
  });
  revalidatePath(`/crm/${id}`);
  return ok(next
    ? `Follow-up saved. Next follow-up: ${phpDate('d M Y, h:i A', next)}.`
    : closed ? `Follow-up saved. The lead is marked ${STATUS_INFO[status].label}.` : 'Follow-up saved. No next follow-up is set.');
}

export async function deleteLead(id: number, back: string): Promise<void> {
  const user = await requireCrmUser();
  const n = await exec('DELETE FROM js_crm_lead WHERE ld_id = $1 AND ld_user_id = $2', [id, user.u_id]);
  await flash(n ? 'success' : 'error', n ? 'Lead deleted.' : 'This lead no longer exists.');
  redirect(back.startsWith('/crm') ? back : '/crm');
}

/** Mark a lead Won / Lost straight from the list. */
export async function setLeadStatus(id: number, status: number, back: string): Promise<void> {
  const user = await requireCrmUser();
  if (status !== LEAD_STATUS.WON && status !== LEAD_STATUS.LOST) return;
  const t = now();
  const n = await exec(
    `UPDATE js_crm_lead SET ld_status = $3, ld_next_followup = 0, ld_updated_on = $4 WHERE ld_id = $1 AND ld_user_id = $2 AND ld_status <> $3`,
    [id, user.u_id, status, t]);
  if (n) await insert('js_crm_followup', { fu_lead_id: id, fu_user_id: user.u_id, fu_type: 'note', fu_status: status, fu_created_on: t, fu_note: '' });
  await flash('success', `Lead marked ${STATUS_INFO[status].label}.`);
  redirect(back.startsWith('/crm') ? back : '/crm');
}

// ------------------------------------------------------------------ settings

export async function saveReminderSettings(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireCrmUser();
  await crmSettings(user.u_id);
  const email = fStr(fd, 'remind_email').toLowerCase();
  const before = fInt(fd, 'remind_before');
  if (email && !isEmail(email)) return invalid({ remind_email: 'Enter a valid email address, or leave it empty for no reminder emails.' });
  if (!REMIND_BEFORE.some((r) => r.value === before)) return invalid({ remind_before: 'Choose when to send the reminder.' });
  await exec('UPDATE js_crm_setting SET cs_remind_email = $2, cs_remind_before = $3, cs_updated_on = $4 WHERE cs_user_id = $1', [user.u_id, email, before, now()]);
  revalidatePath('/crm/settings');
  return ok(email ? `Reminders will be emailed to ${email}.` : 'Reminder emails are off. Due follow-ups still show in the panel.');
}

/** Save the Facebook App secret and Page token; with a token, check it and subscribe the Page to leads. */
export async function saveFacebookSettings(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireCrmUser();
  const s = await crmSettings(user.u_id);
  const secret = fStr(fd, 'app_secret');
  const token = fStr(fd, 'page_token');
  // The saved values are never sent back to the browser: empty fields keep them
  const newSecret = fd.get('clear_secret') ? '' : secret || s.cs_fb_app_secret;
  const newToken = fd.get('clear_token') ? '' : token || s.cs_fb_page_token;
  if (secret && !/^[a-f0-9]{32}$/i.test(secret)) return invalid({ app_secret: 'The App secret is 32 letters and digits (Meta App → App settings → Basic).' });
  let page = { id: token ? '' : s.cs_fb_page_id, name: token ? '' : s.cs_fb_page_name };
  let message = 'Facebook settings saved.';
  if (token) {
    const res = await connectFacebookPage(token);
    if (!res.ok) return invalid({ page_token: res.error });
    page = { id: res.id, name: res.name };
    message = `Connected: leads from the Page “${res.name}” now come into the CRM.`;
  }
  if (!newToken) page = { id: '', name: '' };
  await exec(
    `UPDATE js_crm_setting SET cs_fb_app_secret = $2, cs_fb_page_token = $3, cs_fb_page_id = $4, cs_fb_page_name = $5, cs_updated_on = $6 WHERE cs_user_id = $1`,
    [user.u_id, newSecret, newToken, page.id, page.name, now()]);
  revalidatePath('/crm/settings');
  return ok(message);
}

/** New webhook URL + verify token (the old URL stops working). */
export async function regenerateWebhook(): Promise<void> {
  const user = await requireCrmUser();
  await crmSettings(user.u_id);
  await exec('UPDATE js_crm_setting SET cs_key = $2, cs_verify_token = $3, cs_updated_on = $4 WHERE cs_user_id = $1', [user.u_id, randomString(32), randomString(20), now()]);
  await flash('success', 'A new webhook URL and verify token were created. Update them wherever the old URL was used.');
  redirect('/crm/settings');
}

// ------------------------------------------------------------------ own lead sources

/** Add one of the account's own lead sources (e.g. Justdial, IndiaMART, Walk-in). */
export async function addLeadSource(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireCrmUser();
  const name = fStr(fd, 'source_name').replace(/\s+/g, ' ');
  if (!name || Array.from(name).length > MAX_SOURCE_NAME) return invalid({ source_name: `Enter a name (up to ${MAX_SOURCE_NAME} characters).` });
  if (isBuiltInSource(name)) return invalid({ source_name: `“${name}” is already in the list.` });
  const own = await customSources(user.u_id);
  const same = own.find((n) => n.toLowerCase() === name.toLowerCase());
  if (same) return invalid({ source_name: `You already have the source “${same}”.` });
  if (own.length >= MAX_CUSTOM_SOURCES) return fail(`You can have up to ${MAX_CUSTOM_SOURCES} sources of your own.`);
  await exec('INSERT INTO js_crm_source (src_user_id, src_name, src_created_on) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [user.u_id, name, now()]);
  revalidatePath('/crm/settings');
  return ok(`Source “${name}” added.`);
}

/** Remove an own source from the lists; leads that have it keep showing its name. */
export async function deleteLeadSource(name: string): Promise<void> {
  const user = await requireCrmUser();
  const n = await exec('DELETE FROM js_crm_source WHERE src_user_id = $1 AND src_name = $2', [user.u_id, name]);
  await flash(n ? 'success' : 'error', n ? `Source “${name}” removed. Leads that have it keep it.` : 'This source no longer exists.');
  revalidatePath('/crm/settings');
}
