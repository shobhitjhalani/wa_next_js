import 'server-only';
import { config } from '../config';
import { exec, query } from '../db';

/**
 * Sending limits set from the admin panel (/wamaster/settings), stored in wa_settings.
 * The .env values (WA_SEND_BATCH, WA_SEND_START_HOUR, WA_SEND_END_HOUR, WA_MSG_EXPIRY) are the defaults.
 *
 * They are applied onto `config` so the synchronous helpers (inSendWindow, expiryCutoff, the ETA) see them;
 * call refreshSendSettings() before using them — each process re-reads at most every 30 s.
 */

export interface SendSettings { sendBatch: number; sendStartHour: number; sendEndHour: number; msgExpiryHours: number }

const KEYS: Record<keyof SendSettings, string> = {
  sendBatch: 'send_batch', sendStartHour: 'send_start_hour', sendEndHour: 'send_end_hour', msgExpiryHours: 'msg_expiry_hours',
};
export const SEND_DEFAULTS: SendSettings = {
  sendBatch: config.sendBatch, sendStartHour: config.sendStartHour, sendEndHour: config.sendEndHour,
  msgExpiryHours: Math.max(1, Math.round(config.messageExpiry / 3600)),
};
export const SEND_BATCH_MAX = 1000;
/** Message expiry bounds in hours (default and per-user override). */
export const MSG_EXPIRY_MIN = 1;
export const MSG_EXPIRY_MAX = 240;
const TTL = 30_000;
let loadedAt = 0;

export function validExpiryHours(h: number): string | null {
  if (!Number.isInteger(h) || h < MSG_EXPIRY_MIN || h > MSG_EXPIRY_MAX) return `Message expiry must be between ${MSG_EXPIRY_MIN} and ${MSG_EXPIRY_MAX} hours.`;
  return null;
}

/** Valid settings or an error message. */
export function validSendSettings(s: SendSettings): string | null {
  if (!Number.isInteger(s.sendBatch) || s.sendBatch < 1 || s.sendBatch > SEND_BATCH_MAX) return `Messages per minute must be between 1 and ${SEND_BATCH_MAX}.`;
  if (!Number.isInteger(s.sendStartHour) || !Number.isInteger(s.sendEndHour) || s.sendStartHour < 0 || s.sendEndHour > 24) return 'Choose valid sending hours.';
  if (s.sendStartHour >= s.sendEndHour) return 'The sending window must end after it starts.';
  return validExpiryHours(s.msgExpiryHours);
}

const current = (): SendSettings => ({
  sendBatch: config.sendBatch, sendStartHour: config.sendStartHour, sendEndHour: config.sendEndHour,
  msgExpiryHours: Math.round(config.messageExpiry / 3600),
});

function apply(s: SendSettings) {
  // config is typed read-only (as const); these keys are the ones the admin may change
  Object.assign(config, { sendBatch: s.sendBatch, sendStartHour: s.sendStartHour, sendEndHour: s.sendEndHour, messageExpiry: s.msgExpiryHours * 3600 });
}

/** Load the admin values onto config (cached per process for 30 s). */
export async function refreshSendSettings(force = false): Promise<SendSettings> {
  if (force || Date.now() - loadedAt > TTL) {
    try {
      const rows = await query<{ key: string; value: string }>('SELECT key, value FROM wa_settings WHERE key = ANY($1::text[])', [Object.values(KEYS)]);
      const stored = new Map(rows.map((r) => [r.key, parseInt(r.value, 10)]));
      const next = { ...SEND_DEFAULTS };
      for (const k of Object.keys(KEYS) as (keyof SendSettings)[]) {
        const v = stored.get(KEYS[k]);
        if (v !== undefined && Number.isFinite(v)) next[k] = v;
      }
      if (!validSendSettings(next)) apply(next);
      loadedAt = Date.now();
    } catch {
      // table missing (not migrated yet) or DB hiccup: keep the current values
    }
  }
  return current();
}

export async function saveSendSettings(s: SendSettings, adminId: number): Promise<void> {
  for (const k of Object.keys(KEYS) as (keyof SendSettings)[]) {
    await exec(
      `INSERT INTO wa_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [KEYS[k], String(s[k]), adminId],
    );
  }
  await refreshSendSettings(true);
}

/** Back to the .env defaults. */
export async function resetSendSettings(): Promise<void> {
  await exec('DELETE FROM wa_settings WHERE key = ANY($1::text[])', [Object.values(KEYS)]);
  apply(SEND_DEFAULTS);
  loadedAt = 0;
}

/** Who changed the limits last (for the admin page). */
export async function sendSettingsChanged(): Promise<{ at: Date; by: string | null } | null> {
  const rows = await query<{ at: Date; by: string | null }>(
    `SELECT s.updated_at AS at, e.emp_name AS by FROM wa_settings s LEFT JOIN js_employee e ON e.emp_id = s.updated_by
      WHERE s.key = ANY($1::text[]) ORDER BY s.updated_at DESC LIMIT 1`, [Object.values(KEYS)]);
  return rows[0] ?? null;
}
