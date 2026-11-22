import 'server-only';
import { config } from '../config';
import { exec, query } from '../db';

/**
 * Graph API versions set in Settings → Graph API (super admin), stored in wa_settings. Empty = the .env default.
 * Only the version part of the URL changes: the host stays the one of WA_API_URL (a local / test host keeps
 * blocking real Meta calls). Applied onto config; each process re-reads at most every 30 s.
 */

export type GraphService = 'app' | 'leads' | 'sdk';

export const GRAPH_SERVICES: Record<GraphService, { setting: string; label: string; help: string }> = {
  app: {
    setting: 'graph_version_app', label: 'WhatsApp & app services',
    help: 'WhatsApp Cloud API: sending, templates, media, phone numbers, webhooks subscription; Facebook Posts; client CRM Page connect.',
  },
  leads: { setting: 'graph_version_leads', label: 'Meta Lead Ads', help: 'Lead Pages, reading leads, ad accounts, creating lead ads (System User token).' },
  sdk: { setting: 'graph_version_sdk', label: 'Facebook Login SDK', help: 'WhatsApp Embedded Signup popup on the user dashboard (FB.init version).' },
};

export const VERSION_RE = /^v\d{1,2}\.\d$/;

const origin = (u: string) => /^https?:\/\/[^/]+/.exec(u)?.[0] ?? 'https://graph.facebook.com';
const versionOf = (u: string) => /\/(v\d+\.\d+)\/?/.exec(u)?.[1] ?? '';

/** The .env URLs as loaded at start. */
const ENV = { app: config.meta.apiUrl, leads: config.metaAds.graphUrl };
const SDK_DEFAULT = 'v27.0';

export const GRAPH_DEFAULTS: Record<GraphService, string> = {
  app: versionOf(ENV.app) || '(none in WA_API_URL)', leads: versionOf(ENV.leads) || 'v25.0', sdk: SDK_DEFAULT,
};

let saved: Partial<Record<GraphService, string>> = {};
let loadedAt = 0;
const TTL = 30_000;

const withVersion = (base: string, v: string | undefined) => (v ? `${origin(base)}/${v}/` : base);

/** Apply the saved versions onto config.meta.apiUrl / config.metaAds.graphUrl (cached 30 s per process). */
export async function refreshGraphVersions(force = false): Promise<void> {
  if (!force && Date.now() - loadedAt < TTL) return;
  try {
    const rows = await query<{ key: string; value: string }>('SELECT key, value FROM wa_settings WHERE key = ANY($1::text[])',
      [Object.values(GRAPH_SERVICES).map((s) => s.setting)]);
    const next: Partial<Record<GraphService, string>> = {};
    for (const k of Object.keys(GRAPH_SERVICES) as GraphService[]) {
      const v = rows.find((r) => r.key === GRAPH_SERVICES[k].setting)?.value.trim();
      if (v && VERSION_RE.test(v)) next[k] = v;
    }
    saved = next;
    // config is read-only in its type; the other admin settings are applied the same way
    Object.assign(config.meta, { apiUrl: withVersion(ENV.app, saved.app) });
    Object.assign(config.metaAds, { graphUrl: withVersion(ENV.leads, saved.leads) });
    loadedAt = Date.now();
  } catch {
    // table missing or DB hiccup: keep the current values
  }
}

/** Versions in use now and whether each is saved here or the default. */
export async function graphVersions(): Promise<Record<GraphService, { version: string; saved: boolean }>> {
  await refreshGraphVersions(true);
  return {
    app: { version: saved.app ?? GRAPH_DEFAULTS.app, saved: !!saved.app },
    leads: { version: saved.leads ?? versionOf(config.metaAds.graphUrl), saved: !!saved.leads },
    sdk: { version: saved.sdk ?? SDK_DEFAULT, saved: !!saved.sdk },
  };
}

/** Facebook JS SDK version for FB.init. */
export async function sdkVersion(): Promise<string> {
  await refreshGraphVersions();
  return saved.sdk ?? SDK_DEFAULT;
}

/** Save the versions ('' = back to the default). */
export async function saveGraphVersions(values: Record<GraphService, string>, adminId: number): Promise<void> {
  for (const k of Object.keys(GRAPH_SERVICES) as GraphService[]) {
    const v = values[k].trim();
    if (!v) await exec('DELETE FROM wa_settings WHERE key = $1', [GRAPH_SERVICES[k].setting]);
    else await exec(
      `INSERT INTO wa_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [GRAPH_SERVICES[k].setting, v, adminId]);
  }
  await refreshGraphVersions(true);
}

/** URL with a given version (for checking a version before it is saved). */
export function urlWithVersion(service: 'app' | 'leads', v: string): string {
  return withVersion(ENV[service], v);
}

export async function graphVersionsChanged(): Promise<{ at: Date; by: string | null } | null> {
  const rows = await query<{ at: Date; by: string | null }>(
    `SELECT s.updated_at AS at, e.emp_name AS by FROM wa_settings s LEFT JOIN js_employee e ON e.emp_id = s.updated_by
      WHERE s.key = ANY($1::text[]) ORDER BY s.updated_at DESC LIMIT 1`, [Object.values(GRAPH_SERVICES).map((s) => s.setting)]);
  return rows[0] ?? null;
}
