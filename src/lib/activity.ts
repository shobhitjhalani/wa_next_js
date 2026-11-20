import 'server-only';
import { headers } from 'next/headers';
import { getAdmin, type Admin } from './auth';
import { exec } from './db';
import { now } from './time';

/**
 * Admin activity log (/wamaster/activity, super admins only): who in the admin panel did what, to which record,
 * when and from where. Written after an action succeeded; never throws (a failed log never breaks the action).
 */

export const ACTIVITY_MODULES: Record<string, string> = {
  auth: 'Sign in', users: 'Users', recharge: 'Recharges', teams: 'Team Members', masters: 'Data Masters',
  reports: 'Reports', settings: 'Sending Limits', fb_posts: 'Facebook Posts', meta_leads: 'Meta Lead Ads',
  media: 'Media Library', backups: 'Database Backups', profile: 'Profile', exports: 'Exports',
};

export interface Activity {
  module: keyof typeof ACTIVITY_MODULES | string;
  /** Short verb phrase: "Updated user", "Deleted Page", "Exported users". */
  action: string;
  /** What it was done to: "TPEM TATA (#11)". */
  target?: string;
  targetId?: number | string;
  /** Changes or extra facts: ["Teams: On → Off", "Password changed"]. */
  details?: string[];
}

/** Record one action of the signed-in staff member (or `as`, e.g. at sign-in). */
export async function logActivity(a: Activity, as?: Pick<Admin, 'emp_id' | 'emp_name'> | null): Promise<void> {
  try {
    const who = as ?? (await getAdmin());
    if (!who) return;
    const h = await headers();
    const ip = requestIp(h);
    await exec(
      `INSERT INTO js_admin_activity (aa_emp_id, aa_emp_name, aa_module, aa_action, aa_target, aa_target_id, aa_details, aa_ip, aa_agent, aa_on)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [who.emp_id, who.emp_name ?? '', a.module, a.action.slice(0, 200), (a.target ?? '').slice(0, 300), String(a.targetId ?? ''),
        (a.details ?? []).filter(Boolean).map((d) => d.slice(0, 500)).slice(0, 60), ip.slice(0, 64), (h.get('user-agent') ?? '').slice(0, 300), now()]);
  } catch (e) {
    console.error('[activity] not logged:', (e as Error).message);
  }
}

/**
 * The visitor's IP: nginx's X-Real-IP ($remote_addr, cannot be faked by the browser); else the first
 * X-Forwarded-For entry (local development without nginx).
 */
export function requestIp(h: Headers): string {
  return (h.get('x-real-ip') || h.get('x-forwarded-for')?.split(',')[0] || '').trim().replace(/^::ffff:/, '').slice(0, 64);
}

/** Never written to the log as values. */
const SECRET = /password|secret|token|api_?key|ai_key|access_code/i;

/**
 * "Label: old → new" for each field whose value changed (secrets only as "changed").
 * `labels` names the fields shown; others are left out.
 */
export function changes(before: Record<string, unknown> | null | undefined, after: Record<string, unknown>, labels: Record<string, string>,
  format: (key: string, v: unknown) => string = (_k, v) => (v === null || v === undefined || v === '' ? '—' : String(v))): string[] {
  const out: string[] = [];
  for (const [key, label] of Object.entries(labels)) {
    if (!(key in after)) continue;
    const a = before?.[key], b = after[key];
    if (String(a ?? '') === String(b ?? '')) continue;
    if (SECRET.test(key)) out.push(`${label} changed`);
    else out.push(`${label}: ${short(format(key, a))} → ${short(format(key, b))}`);
  }
  return out;
}

const short = (v: string) => (v.length > 80 ? v.slice(0, 77) + '…' : v);
