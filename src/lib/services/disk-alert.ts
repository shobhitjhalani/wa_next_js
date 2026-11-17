import 'server-only';
import { stat, statfs } from 'node:fs/promises';
import os from 'node:os';
import { config } from '../config';
import { exec, value } from '../db';
import { escapeHtml } from '../text';
import { sendMail } from './mailer';

/**
 * Disk-space alert: email DISK_ALERT_EMAIL (default REPORT_ADMIN_EMAIL) when a disk the
 * app writes to (media, API media, the app folder) is DISK_ALERT_PERCENT (90) % full.
 * While it stays full the email repeats once a day; one "back to normal" email follows.
 */

const STATE_KEY = 'disk_alert_sent_at';
const REPEAT_MS = 24 * 3600_000;

export interface DiskUsage { path: string; total: number; free: number; used: number; percent: number }

const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(1) + ' GB';

/** Usage of each distinct filesystem behind the app's folders. */
export async function diskUsage(): Promise<DiskUsage[]> {
  const seen = new Set<number>();
  const out: DiskUsage[] = [];
  for (const p of [process.cwd(), config.mediaPath, config.apiMediaPath]) {
    const st = await stat(p).catch(() => null);
    if (!st || seen.has(st.dev)) continue;
    seen.add(st.dev);
    const fs = await statfs(p);
    const total = fs.blocks * fs.bsize;
    const free = fs.bavail * fs.bsize; // what non-root processes can still write
    const used = total - fs.bfree * fs.bsize;
    // Like df: used / (used + available)
    out.push({ path: p, total, free, used, percent: used + free ? Math.round((used / (used + free)) * 1000) / 10 : 0 });
  }
  return out;
}

function table(disks: DiskUsage[], limit: number): string {
  const rows = disks.map((d) => `<tr>
      <td style="padding:6px 10px;border:1px solid #ddd">${escapeHtml(d.path)}</td>
      <td style="padding:6px 10px;border:1px solid #ddd;text-align:right;${d.percent >= limit ? 'color:#c0392b;font-weight:bold' : ''}">${d.percent}%</td>
      <td style="padding:6px 10px;border:1px solid #ddd;text-align:right">${gb(d.used)}</td>
      <td style="padding:6px 10px;border:1px solid #ddd;text-align:right">${gb(d.free)}</td>
      <td style="padding:6px 10px;border:1px solid #ddd;text-align:right">${gb(d.total)}</td></tr>`).join('');
  return `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">
    <tr style="background:#f5f5f5"><th style="padding:6px 10px;border:1px solid #ddd;text-align:left">Folder</th><th style="padding:6px 10px;border:1px solid #ddd">Used %</th>
    <th style="padding:6px 10px;border:1px solid #ddd">Used</th><th style="padding:6px 10px;border:1px solid #ddd">Free</th><th style="padding:6px 10px;border:1px solid #ddd">Size</th></tr>${rows}</table>`;
}

/** The hourly check. `force` sends the email now if the disk is full, ignoring the once-a-day limit. */
export async function checkDiskSpace(log: (m: string) => void = console.log, opts: { force?: boolean } = {}): Promise<void> {
  const limit = config.diskAlert.percent;
  const disks = await diskUsage();
  const worst = disks.reduce((a, d) => (d.percent > a ? d.percent : a), 0);
  const summary = disks.map((d) => `${d.path} ${d.percent}% (${gb(d.free)} free)`).join('; ');
  const lastSent = await value<string>('SELECT value FROM wa_settings WHERE key = $1', [STATE_KEY]);
  const to = config.diskAlert.email;
  const host = os.hostname();

  if (worst < limit) {
    if (lastSent) {
      await exec('DELETE FROM wa_settings WHERE key = $1', [STATE_KEY]);
      if (to) {
        await sendMail({
          to,
          subject: `Disk space back to normal (${worst}% used) — ${host}`,
          html: `<p>Disk usage on <b>${escapeHtml(host)}</b> is back below ${limit}%.</p>${table(disks, limit)}`,
        });
      }
      log(`Back below ${limit}%: ${summary}. Recovery email ${to ? 'sent' : 'skipped (no address)'}.`);
    } else {
      log(`OK (alert at ${limit}%): ${summary}.`);
    }
    return;
  }

  if (!opts.force && lastSent && Date.now() - Number(lastSent) < REPEAT_MS) {
    log(`${worst}% used — alert already sent ${new Date(Number(lastSent)).toISOString()}: ${summary}.`);
    return;
  }
  if (!to) {
    log(`${worst}% used but DISK_ALERT_EMAIL / REPORT_ADMIN_EMAIL is not set: ${summary}.`);
    return;
  }
  await sendMail({
    to,
    subject: `⚠ Disk ${worst}% full — ${host}`,
    html: `<p style="font-family:Arial,sans-serif">The server disk on <b>${escapeHtml(host)}</b> is <b>${worst}%</b> full (alert level ${limit}%).
      When it is full, uploads, media and the database stop working.</p>
      ${table(disks, limit)}
      <p style="font-family:Arial,sans-serif">Free space: delete old backups or media, or resize the droplet's disk.
      API attachment files older than ${config.apiMediaDays} days and sent-media folders are removed every night at 02:30.</p>
      <p style="font-family:Arial,sans-serif;color:#888">This alert repeats once a day while the disk stays above ${limit}%.</p>`,
  });
  await exec(
    `INSERT INTO wa_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [STATE_KEY, String(Date.now())],
  );
  log(`${worst}% used — alert emailed to ${to}: ${summary}.`);
}
