'use server';

import { revalidatePath } from 'next/cache';
import { flash, fStr, invalid, ok, type ActionResult } from '@/lib/actions';
import { config } from '@/lib/config';
import { createGraph, MetaError } from '@/lib/meta-graph';
import { META_KEYS, saveMetaSettings, type MetaKey } from '@/lib/services/meta-settings';
import { forgetMetaToken, signupIds, waToken } from '@/lib/services/meta';
import { systemToken } from '@/lib/services/meta-leads';
import { exec } from '@/lib/db';
import { logActivity } from '@/lib/activity';
import { requireAdminCan } from '@/lib/auth';
import { resetSendSettings, saveSendSettings, validSendSettings } from '@/lib/services/settings';
import { GRAPH_SERVICES, refreshGraphVersions, saveGraphVersions, urlWithVersion, VERSION_RE, type GraphService } from '@/lib/services/graph-version';

/** Save the sending limits (super admin). */
export async function saveSendLimits(form: FormData): Promise<void> {
  const me = await requireAdminCan('super');
  const s = {
    sendBatch: Number(form.get('send_batch')),
    sendStartHour: Number(form.get('send_start_hour')),
    sendEndHour: Number(form.get('send_end_hour')),
    msgExpiryHours: Number(form.get('msg_expiry_hours')),
  };
  const error = validSendSettings(s);
  if (error) await flash('error', error);
  else {
    await saveSendSettings(s, me.emp_id);
    await logActivity({ module: 'settings', action: 'Saved sending limits', details: [`Batch: ${s.sendBatch}`, `Window: ${s.sendStartHour}:00 – ${s.sendEndHour}:00`, `Message expiry: ${s.msgExpiryHours} h`] });
    await flash('success', 'Sending limits saved. The sender uses them from its next run (within a minute).');
  }
  revalidatePath('/wamaster/settings');
}

export async function resetSendLimits(): Promise<void> {
  await requireAdminCan('super');
  await resetSendSettings();
  await logActivity({ module: 'settings', action: 'Reset sending limits to the defaults' });
  await flash('success', 'Sending limits reset to the server defaults.');
  revalidatePath('/wamaster/settings');
}

/** Meta Lead Ads keys (super admin): a typed value replaces the saved one, an empty field keeps it, "clear" goes back to .env. */
export async function saveMetaKeys(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const me = await requireAdminCan('super');
  const token = fStr(fd, 'system_user_token').replace(/\s+/g, '');
  const secret = fStr(fd, 'app_secret').trim();
  const verify = fStr(fd, 'webhook_verify_token').trim();
  const clear = (['systemUserToken', 'appSecret', 'webhookVerifyToken'] as MetaKey[]).filter((k) => fd.get(`clear_${k}`) === '1');
  const errors: Record<string, string> = {};
  if (token && (token.length < 50 || !/^EA[A-Za-z0-9]+$/.test(token))) errors.system_user_token = 'Paste the whole token: a long text starting with EAA…';
  if (secret && !/^[0-9a-f]{32}$/i.test(secret)) errors.app_secret = 'The App secret is 32 letters and digits (App settings → Basic → App secret → Show).';
  if (verify && !/^[\x21-\x7e]{8,200}$/.test(verify)) errors.webhook_verify_token = 'At least 8 characters, no spaces.';
  if (Object.keys(errors).length) return invalid(errors);
  if (!token && !secret && !verify && !clear.length) return invalid({ system_user_token: 'Type a new value, or tick “Remove” to go back to the .env value.' });

  await saveMetaSettings({ systemUserToken: token, appSecret: secret, webhookVerifyToken: verify }, clear, me.emp_id);
  const changed = [
    ...(token ? ['System User token changed'] : []), ...(secret ? ['App secret changed'] : []), ...(verify ? ['Webhook verify token changed'] : []),
    ...clear.map((k) => `${META_KEYS[k].label} removed (back to .env)`),
  ];
  await logActivity({ module: 'settings', action: 'Changed Meta Lead Ads keys', details: changed });

  // Check a new token with Meta (who it belongs to); it is saved either way
  let check = '';
  if (token) {
    await refreshGraphVersions();
    try {
      const who = await createGraph({ baseUrl: config.metaAds.graphUrl, token, retries: 0 }).get<{ id?: string; name?: string }>('me', { fields: 'id,name' });
      check = ` Meta accepted the token: it belongs to “${who.name ?? who.id}”.`;
    } catch (e) {
      check = ` Meta did not accept the token: ${e instanceof MetaError ? e.describe() : 'no answer'}. Check it before creating ads.`;
    }
  }
  revalidatePath('/wamaster/settings/meta');
  revalidatePath('/wamaster/meta_leads');
  return ok(`Saved: ${changed.join(', ')}. In use within 30 seconds (the app and the worker).${check}`);
}

/**
 * WhatsApp sending token (WA_TOKEN_KEY): every WhatsApp message is sent with it. Meta is asked first; a token it
 * refuses is only saved with "save anyway" (a wrong token stops all sending).
 */
export async function saveWaToken(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const me = await requireAdminCan('super');
  const token = fStr(fd, 'wa_token').replace(/\s+/g, '');
  if (!token || token.length < 50 || !/^EA[A-Za-z0-9]+$/.test(token)) return invalid({ wa_token: 'Paste the whole token: a long text starting with EAA…' });
  const old = await waToken();
  if (old.value === token) return ok('This is already the token in use; nothing changed.');

  let check = '';
  await refreshGraphVersions();
  try {
    const res = await fetch(`${config.meta.apiUrl}me?fields=id,name`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    const body = await res.json().catch(() => ({})) as { id?: string; name?: string; error?: { message?: string; code?: number } };
    if (body.error) {
      if (fd.get('force') !== '1') {
        return invalid({ wa_token: `Meta refused this token: ${body.error.message ?? 'error'} (code ${body.error.code ?? res.status}). It was NOT saved; WhatsApp keeps sending with the current token. Tick “Save anyway” only if you are sure.` });
      }
      check = ` Meta refused it (${body.error.message ?? 'error'}), saved anyway: check that messages are sent.`;
    } else check = ` Meta accepted it: “${body.name ?? body.id}”.`;
  } catch {
    check = ' Meta could not be reached to check it; check that messages are sent.';
  }
  await exec(
    `INSERT INTO wa_settings (key, value, updated_by, updated_at) VALUES ('wa_token_key', $1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`, [token, me.emp_id]);
  forgetMetaToken();
  await logActivity({ module: 'settings', action: 'Changed the WhatsApp sending token', details: [`Was from: ${old.source}`, check.trim()] });
  revalidatePath('/wamaster/settings/whatsapp');
  return ok(`WhatsApp token saved; all sending uses it within 30 seconds.${check}`);
}

/** Embedded Signup ("Login with Facebook" on the user dashboard): the Facebook App ID and its Login configuration ID. */
export async function saveSignupIds(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const me = await requireAdminCan('super');
  const appIdIn = fStr(fd, 'signup_app_id').trim();
  const configIdIn = fStr(fd, 'signup_config_id').trim();
  const errors: Record<string, string> = {};
  if (appIdIn && !/^\d{5,25}$/.test(appIdIn)) errors.signup_app_id = 'The App ID is a number (App settings → Basic).';
  if (configIdIn && !/^\d{5,25}$/.test(configIdIn)) errors.signup_config_id = 'The Configuration ID is a number (Facebook Login for Business → Configurations).';
  if (Object.keys(errors).length) return invalid(errors);
  const before = await signupIds();
  for (const [key, v] of [['fb_signup_app_id', appIdIn], ['fb_signup_config_id', configIdIn]] as const) {
    if (v) {
      await exec(
        `INSERT INTO wa_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`, [key, v, me.emp_id]);
    } else await exec('DELETE FROM wa_settings WHERE key = $1', [key]);
  }
  const after = await signupIds();
  await logActivity({ module: 'settings', action: 'Changed Embedded Signup IDs', details: [
    ...(before.appId !== after.appId ? [`App ID: ${before.appId} → ${after.appId}`] : []),
    ...(before.configId !== after.configId ? [`Configuration ID: ${before.configId} → ${after.configId}`] : []),
  ] });
  revalidatePath('/wamaster/settings/whatsapp');
  return ok('Embedded Signup IDs saved: the user dashboard uses them at once.');
}

/**
 * Graph API versions (super admin). Each typed version is first tried with Meta (GET /me with the matching token):
 * a version Meta does not know is refused; an empty field goes back to the server default.
 */
export async function saveGraphVersionsAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const me = await requireAdminCan('super');
  const values = {} as Record<GraphService, string>;
  const errors: Record<string, string> = {};
  for (const k of Object.keys(GRAPH_SERVICES) as GraphService[]) {
    const v = fStr(fd, `graph_${k}`).trim().toLowerCase().replace(/^(\d)/, 'v$1');
    if (v && !VERSION_RE.test(v)) errors[`graph_${k}`] = 'Write it like v25.0';
    values[k] = v;
  }
  if (Object.keys(errors).length) return invalid(errors);

  // Ask Meta whether it knows the version (an unknown / expired version answers with an error about the version)
  const tokens = { app: (await waToken()).value, leads: await systemToken() };
  const notes: string[] = [];
  for (const k of ['app', 'leads'] as const) {
    if (!values[k] || !tokens[k]) continue;
    try {
      const res = await fetch(`${urlWithVersion(k, values[k])}me?fields=id`, { headers: { Authorization: `Bearer ${tokens[k]}` }, signal: AbortSignal.timeout(15_000) });
      const body = await res.json().catch(() => ({})) as { error?: { message?: string; code?: number } };
      const msg = String(body.error?.message ?? '');
      if (body.error && /version|unknown path components/i.test(msg)) errors[`graph_${k}`] = `Meta refused ${values[k]}: ${msg}`;
      else if (body.error) notes.push(`${GRAPH_SERVICES[k].label}: Meta answered “${msg}” (not about the version)`);
    } catch {
      notes.push(`${GRAPH_SERVICES[k].label}: could not reach Meta to check ${values[k]}`);
    }
  }
  if (Object.keys(errors).length) return invalid(errors);

  await saveGraphVersions(values, me.emp_id);
  forgetMetaToken();
  await logActivity({
    module: 'settings', action: 'Changed Graph API versions',
    details: (Object.keys(GRAPH_SERVICES) as GraphService[]).map((k) => `${GRAPH_SERVICES[k].label}: ${values[k] || 'default'}`),
  });
  revalidatePath('/wamaster/settings/graph');
  return ok(`Saved. The app and the worker use them within 30 seconds.${notes.length ? ` ${notes.join('; ')}.` : ''}`);
}
