'use server';

import { revalidatePath } from 'next/cache';
import { fail, fStr, invalid, ok, type ActionResult } from '@/lib/actions';
import { logActivity } from '@/lib/activity';
import { requireAdminCan } from '@/lib/auth';
import { CRM_WA_DAYS_MAX, crmWaSettings, maskKey, saveCrmWaSettings, sendExpiryReport } from '@/lib/services/expiry-report';

/** Settings → CRM WA (super admin). An empty API key keeps the saved one. */
export async function saveCrmWa(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const me = await requireAdminCan('super');
  const old = await crmWaSettings();
  const apiUrl = fStr(fd, 'api_url').trim();
  const typedKey = fStr(fd, 'api_key').trim();
  const groupIds = fStr(fd, 'group_ids').split(/[\s,]+/).filter(Boolean).join(',');
  const mobileNos = fStr(fd, 'mobile_nos').split(/[\s,]+/).filter(Boolean).join(',');
  const days = Number(fStr(fd, 'days'));
  const enabled = fd.get('enabled') === '1';
  const limitPercent = Number(fStr(fd, 'limit_percent'));

  const errors: Record<string, string> = {};
  if (!/^https?:\/\/\S+$/i.test(apiUrl)) errors.api_url = 'Enter the API URL (https://…).';
  if (typedKey && !/^[\x21-\x7e]{6,200}$/.test(typedKey)) errors.api_key = 'The x-api-key has no spaces (6–200 characters).';
  if (groupIds && !groupIds.split(',').every((g) => /^[\w.@-]{3,80}$/.test(g))) errors.group_ids = 'Group IDs look like 120363431942002851@g.us, separated by commas.';
  if (mobileNos && !mobileNos.split(',').every((m) => /^\+?\d{8,15}$/.test(m))) errors.mobile_nos = 'Mobile numbers with country code (e.g. 919876543210), separated by commas.';
  if (!Number.isInteger(days) || days < 1 || days > CRM_WA_DAYS_MAX) errors.days = `Days must be between 1 and ${CRM_WA_DAYS_MAX}.`;
  if (!Number.isInteger(limitPercent) || limitPercent < 1 || limitPercent > 100) errors.limit_percent = 'The percentage must be between 1 and 100.';
  const apiKey = typedKey || old.apiKey;
  if (enabled && !apiKey) errors.api_key = 'The x-api-key is required to switch the report on.';
  if (enabled && !groupIds && !mobileNos) errors.group_ids = 'Enter a group ID or a mobile number to send the report to.';
  if (Object.keys(errors).length) return invalid(errors);

  await saveCrmWaSettings({ enabled, apiUrl, apiKey, groupIds, mobileNos, days, limitPercent }, me.emp_id);
  await logActivity({
    module: 'settings', action: 'Saved CRM WA expiry report settings',
    details: [`Report: ${enabled ? 'On' : 'Off'}`, `Days: ${days}`, `Sending limit left: ${limitPercent}%`, `API URL: ${apiUrl}`, typedKey ? `x-api-key changed (${maskKey(typedKey)})` : 'x-api-key unchanged',
      `Groups: ${groupIds || '—'}`, `Mobiles: ${mobileNos || '—'}`],
  });
  revalidatePath('/wamaster/settings/crm_wa');
  return ok('Saved.');
}

/** Send the report now (also when switched off); nothing is sent when no user is expiring or low on sending limit. */
export async function sendCrmWaNow(_prev: ActionResult | null): Promise<ActionResult> {
  await requireAdminCan('super');
  const r = await sendExpiryReport({ force: true });
  await logActivity({ module: 'settings', action: 'Sent the expiry report now', details: [`Accounts: ${r.accounts}`, `Messages sent: ${r.sent}`, ...(r.skipped ? [`Skipped: ${r.skipped}`] : []), ...r.errors] });
  if (r.skipped) return fail(`Not sent: ${r.skipped}.`);
  if (r.errors.length) return fail(`${r.sent} message(s) sent, errors:\n${r.errors.join('\n')}`);
  return ok(`Sent: ${r.accounts} user(s) in ${r.sent} message(s).`);
}
