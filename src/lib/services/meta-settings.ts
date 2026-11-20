import 'server-only';
import { config } from '../config';
import { exec, query } from '../db';

/**
 * Meta Lead Ads keys set from the admin panel (/wamaster/settings/meta, super admins), stored in wa_settings.
 * The .env values (META_SYSTEM_USER_TOKEN, META_LEADS_APP_SECRET / META_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN) are
 * the fallback. Applied onto config.metaAds; each process re-reads at most every 30 s (refreshMetaSettings).
 * The values are never shown back in full, logged or put in URLs.
 */

export type MetaKey = 'systemUserToken' | 'appSecret' | 'webhookVerifyToken';

export const META_KEYS: Record<MetaKey, { setting: string; env: string; label: string }> = {
  systemUserToken: { setting: 'meta_system_user_token', env: 'META_SYSTEM_USER_TOKEN', label: 'System User token' },
  appSecret: { setting: 'meta_leads_app_secret', env: 'META_LEADS_APP_SECRET / META_APP_SECRET', label: 'App secret (Lead Ads app)' },
  webhookVerifyToken: { setting: 'meta_webhook_verify_token', env: 'META_WEBHOOK_VERIFY_TOKEN', label: 'Webhook verify token' },
};

/** The .env values, as loaded at start. */
const ENV: Record<MetaKey, string> = {
  systemUserToken: config.metaAds.systemUserToken,
  appSecret: config.metaAds.appSecret,
  webhookVerifyToken: config.metaAds.webhookVerifyToken,
};

const TTL = 30_000;
let loadedAt = 0;
let fromDb: Partial<Record<MetaKey, string>> = {};

/** Apply the admin values (else .env) onto config.metaAds; cached per process for 30 s. */
export async function refreshMetaSettings(force = false): Promise<void> {
  if (!force && Date.now() - loadedAt < TTL) return;
  try {
    const rows = await query<{ key: string; value: string }>('SELECT key, value FROM wa_settings WHERE key = ANY($1::text[])',
      [Object.values(META_KEYS).map((k) => k.setting)]);
    const stored = new Map(rows.map((r) => [r.key, r.value]));
    fromDb = {};
    for (const k of Object.keys(META_KEYS) as MetaKey[]) {
      const v = stored.get(META_KEYS[k].setting)?.trim();
      if (v) fromDb[k] = v;
      Object.assign(config.metaAds, { [k]: v || ENV[k] }); // config is read-only in its type; the send settings do the same
    }
    loadedAt = Date.now();
  } catch {
    // table missing or DB hiccup: keep the current values
  }
}

/** For the admin page: where each key comes from and its last 4 characters (never the value). */
export async function metaSettingsStatus(): Promise<Record<MetaKey, { source: 'settings' | 'env' | 'none'; hint: string; updated: { at: Date; by: string | null } | null }>> {
  await refreshMetaSettings(true);
  const rows = await query<{ key: string; at: Date; by: string | null }>(
    `SELECT s.key, s.updated_at AS at, e.emp_name AS by FROM wa_settings s LEFT JOIN js_employee e ON e.emp_id = s.updated_by WHERE s.key = ANY($1::text[])`,
    [Object.values(META_KEYS).map((k) => k.setting)]);
  const out = {} as Awaited<ReturnType<typeof metaSettingsStatus>>;
  for (const k of Object.keys(META_KEYS) as MetaKey[]) {
    const v = config.metaAds[k];
    const row = rows.find((r) => r.key === META_KEYS[k].setting);
    out[k] = { source: fromDb[k] ? 'settings' : v ? 'env' : 'none', hint: v ? `…${v.slice(-4)} (${v.length} characters)` : '', updated: row ? { at: row.at, by: row.by } : null };
  }
  return out;
}

/** Save the keys that were typed (others stay); `clear` removes the saved value (back to .env). */
export async function saveMetaSettings(values: Partial<Record<MetaKey, string>>, clear: MetaKey[], adminId: number): Promise<void> {
  for (const k of clear) await exec('DELETE FROM wa_settings WHERE key = $1', [META_KEYS[k].setting]);
  for (const [k, v] of Object.entries(values) as [MetaKey, string][]) {
    if (!v) continue;
    await exec(
      `INSERT INTO wa_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [META_KEYS[k].setting, v, adminId]);
  }
  await refreshMetaSettings(true);
}
