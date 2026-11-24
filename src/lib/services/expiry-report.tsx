import 'server-only';
import { randomBytes } from 'node:crypto';
import { ImageResponse } from 'next/og';
import { exec, query } from '../db';
import { addDays, dayStart, now, phpDate } from '../time';
import { USER_TYPE } from '../types';
import { storeBytes } from './media';

/**
 * Daily account report sent to a WhatsApp group / numbers through the CRM WhatsApp API (Settings → CRM WA).
 * Every day at 11:00 (worker job 'expiry-report') two lists of active WhatsApp users are checked:
 *   - accounts expiring in the next N days (default 7): User Name, Company, Expiry Date;
 *   - accounts with a template message limit whose remaining messages are at or below the threshold (default 20 %).
 * Each list with users is drawn on a PNG stored under /media/reports and sent as filePathUrl with the list as text.
 * Nothing is sent when no user is in either list.
 */

export interface CrmWaSettings {
  enabled: boolean;
  apiUrl: string;
  apiKey: string;
  groupIds: string;
  mobileNos: string;
  days: number;
  /** Remaining sending limit (%) at or below which a user is reported. */
  limitPercent: number;
}

export const CRM_WA_DEFAULTS: CrmWaSettings = {
  enabled: false,
  apiUrl: 'https://crm.jscoretech.com/api/secure/v1/send_message/',
  apiKey: '',
  groupIds: '',
  mobileNos: '',
  days: 7,
  limitPercent: 20,
};
export const CRM_WA_DAYS_MAX = 90;
/** Rows per image; a longer list is sent as several images. */
const ROWS_PER_IMAGE = 25;

const KEYS: Record<keyof CrmWaSettings, string> = {
  enabled: 'crm_wa_enabled', apiUrl: 'crm_wa_api_url', apiKey: 'crm_wa_api_key',
  groupIds: 'crm_wa_group_ids', mobileNos: 'crm_wa_mobile_nos', days: 'crm_wa_days', limitPercent: 'crm_wa_limit_percent',
};

export async function crmWaSettings(): Promise<CrmWaSettings> {
  const rows = await query<{ key: string; value: string }>('SELECT key, value FROM wa_settings WHERE key = ANY($1::text[])', [Object.values(KEYS)]);
  const v = new Map(rows.map((r) => [r.key, r.value]));
  const days = parseInt(v.get(KEYS.days) ?? '', 10);
  const pct = parseInt(v.get(KEYS.limitPercent) ?? '', 10);
  return {
    enabled: v.get(KEYS.enabled) === '1',
    apiUrl: v.get(KEYS.apiUrl) || CRM_WA_DEFAULTS.apiUrl,
    apiKey: v.get(KEYS.apiKey) ?? '',
    groupIds: v.get(KEYS.groupIds) ?? '',
    mobileNos: v.get(KEYS.mobileNos) ?? '',
    days: Number.isInteger(days) && days >= 1 && days <= CRM_WA_DAYS_MAX ? days : CRM_WA_DEFAULTS.days,
    limitPercent: Number.isInteger(pct) && pct >= 0 && pct <= 100 ? pct : CRM_WA_DEFAULTS.limitPercent,
  };
}

export async function saveCrmWaSettings(s: CrmWaSettings, adminId: number): Promise<void> {
  const values: Record<keyof CrmWaSettings, string> = {
    enabled: s.enabled ? '1' : '0', apiUrl: s.apiUrl, apiKey: s.apiKey, groupIds: s.groupIds, mobileNos: s.mobileNos,
    days: String(s.days), limitPercent: String(s.limitPercent),
  };
  for (const k of Object.keys(KEYS) as (keyof CrmWaSettings)[]) {
    await exec(
      `INSERT INTO wa_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [KEYS[k], values[k], adminId],
    );
  }
}

/** "abcd…wxyz" for showing a saved key. */
export function maskKey(key: string): string {
  return key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : key ? '••••' : '';
}

interface UserBase { u_id: number; name: string; username: string; company: string }
export interface ExpiringAccount extends UserBase { valid_till: number }
export interface LowLimitAccount extends UserBase { msg_limit: number; msg_used: number; remaining: number; percent: number }

const USER_COLS = `u_id, COALESCE(NULLIF(u_name, ''), u_username, '') AS name, COALESCE(u_username, '') AS username, COALESCE(u_company_name, '') AS company`;

/** Active WhatsApp users whose plan ends from now up to the end of day `days` from today. */
export async function expiringAccounts(days: number): Promise<ExpiringAccount[]> {
  return query<ExpiringAccount>(
    `SELECT ${USER_COLS}, u_valid_till AS valid_till
       FROM js_user
      WHERE u_dstatus = 0 AND u_status = 1 AND u_type = $1 AND u_valid_till >= $2 AND u_valid_till < $3
      ORDER BY u_valid_till, u_id`,
    [USER_TYPE.WHATSAPP, now(), addDays(dayStart(), days + 1)],
  );
}

/** Active WhatsApp users with a template message limit whose remaining messages are at or below `percent` % of it. */
export async function lowLimitAccounts(percent: number): Promise<LowLimitAccount[]> {
  return query<LowLimitAccount>(
    `SELECT ${USER_COLS}, u_msg_limit AS msg_limit, u_msg_used AS msg_used,
            GREATEST(u_msg_limit - u_msg_used, 0) AS remaining,
            ROUND(GREATEST(u_msg_limit - u_msg_used, 0) * 100.0 / u_msg_limit, 1)::float AS percent
       FROM js_user
      WHERE u_dstatus = 0 AND u_status = 1 AND u_type = $1 AND u_msg_limit > 0
        AND GREATEST(u_msg_limit - u_msg_used, 0) * 100 <= u_msg_limit * $2
      ORDER BY percent, u_id`,
    [USER_TYPE.WHATSAPP, percent],
  );
}

const daysLeft = (ts: number) => Math.max(0, Math.round((dayStart(ts) - dayStart()) / 86400));
const leftLabel = (n: number) => (n === 0 ? 'Today' : n === 1 ? '1 day' : `${n} days`);
const fmt = (n: number) => Number(n).toLocaleString('en-IN');
/** Keep text the bundled font can draw (other glyphs would make the renderer fetch fonts from Google). */
const latin = (s: string, max = 40) => {
  const t = s.replace(/[^\x20-\x7E -ɏ]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
};

interface Column { label: string; width: number; align?: 'end' }
interface Cell { text: string; sub?: string; strong?: boolean; badge?: 'red' | 'amber' }
interface Section { key: string; title: string; subtitle: string; columns: Column[]; rows: Cell[][]; textLines: string[]; heading: string }

/** PNG of one page of a report table. */
export async function tableImage(title: string, subtitle: string, columns: Column[], rows: Cell[][], offset = 0): Promise<Buffer> {
  const width = 1100;
  const height = 190 + rows.length * 52 + 60;
  const cell = (c: Column, extra: React.CSSProperties = {}) =>
    ({ width: c.width, flexShrink: 0, display: 'flex', justifyContent: c.align === 'end' ? 'flex-end' : 'flex-start', ...extra }) as React.CSSProperties;
  // Table content is 1000 px wide (1100 − page and card padding): the # column + the columns add up to that
  const no: Column = { label: '#', width: 50 };
  const img = new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#f3f6f9', padding: 30, fontSize: 22, color: '#212529' }}>
        <div style={{ display: 'flex', flexDirection: 'column', background: '#405189', color: 'white', borderRadius: 12, padding: '18px 24px' }}>
          <div style={{ display: 'flex', fontSize: 32, fontWeight: 700 }}>{title}</div>
          <div style={{ display: 'flex', fontSize: 20, opacity: 0.85, marginTop: 4 }}>{subtitle}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', background: 'white', borderRadius: 12, marginTop: 16, padding: '6px 20px' }}>
          <div style={{ display: 'flex', fontWeight: 700, color: '#878a99', fontSize: 18, padding: '12px 0', borderBottom: '2px solid #e9ebec' }}>
            <div style={cell(no)}>#</div>
            {columns.map((c) => <div key={c.label} style={cell(c)}>{c.label.toUpperCase()}</div>)}
          </div>
          {rows.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', height: 52, borderBottom: i < rows.length - 1 ? '1px solid #f0f1f2' : 'none' }}>
              <div style={cell(no, { color: '#878a99' })}>{String(offset + i + 1)}</div>
              {columns.map((c, j) => {
                const v = r[j];
                if (v.badge) {
                  return (
                    <div key={j} style={cell(c)}>
                      <div style={{ display: 'flex', padding: '4px 12px', borderRadius: 20, fontSize: 18, fontWeight: 600,
                        background: v.badge === 'red' ? '#fde8e4' : '#fef4e4', color: v.badge === 'red' ? '#f06548' : '#f7b84b' }}>{v.text}</div>
                    </div>
                  );
                }
                return (
                  <div key={j} style={cell(c, { flexDirection: 'column', alignItems: c.align === 'end' ? 'flex-end' : 'flex-start' })}>
                    <div style={{ display: 'flex', fontWeight: v.strong ? 600 : 400 }}>{v.text || '-'}</div>
                    {v.sub ? <div style={{ display: 'flex', fontSize: 15, color: '#878a99' }}>{v.sub}</div> : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    ),
    { width, height },
  );
  return Buffer.from(await img.arrayBuffer());
}

const nameCell = (r: UserBase): Cell => ({ text: latin(r.name, 28), sub: r.username && r.username !== r.name ? latin(r.username, 32) : undefined, strong: true });

function expirySection(rows: ExpiringAccount[], days: number): Section {
  return {
    key: 'expiry',
    title: `Users Expiring in Next ${days} Days`,
    subtitle: `Account renewal due  |  ${phpDate('d-m-Y')} to ${phpDate('d-m-Y', addDays(dayStart(), days))}`,
    heading: `*Users Expiring in Next ${days} Days*\n${rows.length} account${rows.length > 1 ? 's' : ''} due for renewal:`,
    columns: [{ label: 'User Name', width: 330 }, { label: 'Company', width: 300 }, { label: 'Expiry Date', width: 170 }, { label: 'Left', width: 150, align: 'end' }],
    rows: rows.map((r) => {
      const left = daysLeft(Number(r.valid_till));
      return [nameCell(r), { text: latin(r.company, 30) }, { text: phpDate('d-m-Y', Number(r.valid_till)), strong: true }, { text: leftLabel(left), badge: left <= 2 ? 'red' : 'amber' }];
    }),
    textLines: rows.map((r) => `${r.name || r.username}${r.company ? ` (${r.company})` : ''} - ${phpDate('d-m-Y', Number(r.valid_till))}`),
  };
}

function limitSection(rows: LowLimitAccount[], percent: number): Section {
  return {
    key: 'limit',
    title: `Sending Limit ${percent}% or Less Left`,
    subtitle: `Template message limit almost used  |  ${phpDate('d-m-Y')}`,
    heading: `*Users with ${percent}% or Less Sending Limit Left*\n${rows.length} account${rows.length > 1 ? 's need' : ' needs'} a top-up:`,
    columns: [{ label: 'User Name', width: 290 }, { label: 'Company', width: 250 }, { label: 'Limit', width: 140, align: 'end' }, { label: 'Remaining', width: 150, align: 'end' }, { label: 'Left', width: 120, align: 'end' }],
    rows: rows.map((r) => [
      nameCell(r), { text: latin(r.company, 24) }, { text: fmt(r.msg_limit) }, { text: fmt(r.remaining), strong: true },
      { text: `${Math.round(Number(r.percent))}%`, badge: Number(r.percent) <= percent / 2 ? 'red' : 'amber' },
    ]),
    textLines: rows.map((r) => `${r.name || r.username}${r.company ? ` (${r.company})` : ''} - ${fmt(r.remaining)} of ${fmt(r.msg_limit)} left (${Math.round(Number(r.percent))}%)`),
  };
}

/** The report sections that have users today (empty = nothing to send). */
export async function reportSections(s: CrmWaSettings): Promise<Section[]> {
  const [expiring, low] = await Promise.all([expiringAccounts(s.days), lowLimitAccounts(s.limitPercent)]);
  return [
    ...(expiring.length ? [expirySection(expiring, s.days)] : []),
    ...(low.length ? [limitSection(low, s.limitPercent)] : []),
  ];
}

/** First image of a section (admin preview). */
export async function previewImage(s: CrmWaSettings, key: string): Promise<Buffer | null> {
  const sec = (await reportSections(s)).find((x) => x.key === key);
  return sec ? tableImage(sec.title, sec.subtitle, sec.columns, sec.rows.slice(0, ROWS_PER_IMAGE)) : null;
}

export interface SendResult { sent: number; accounts: number; skipped?: string; errors: string[] }

/** POST one message to the CRM WhatsApp API. */
async function postMessage(s: CrmWaSettings, message: string, fileUrl: string): Promise<void> {
  const res = await fetch(s.apiUrl, {
    method: 'POST',
    headers: { 'x-api-key': s.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      receiverMobileNo: s.mobileNos, recipientGroupIds: s.groupIds, message, filePathUrl: fileUrl, bot: '1', base64File: [], sheetid: '',
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  // The API may answer 200 with an error flag
  let j: { status?: unknown; success?: unknown; error?: unknown; message?: unknown } | null = null;
  try { j = JSON.parse(text); } catch { /* not JSON: HTTP 200 is success */ }
  if (j && (j.success === false || j.status === false || j.status === 'error' || (j.error && j.error !== false))) {
    throw new Error(String(j.message ?? j.error ?? text).slice(0, 300));
  }
}

/**
 * Build and send the report. `force` (admin "Send now") sends even when the report is switched off.
 * Nothing is sent when no user is expiring or low on sending limit.
 */
export async function sendExpiryReport(opts: { force?: boolean } = {}, log: (m: string) => void = () => {}): Promise<SendResult> {
  const s = await crmWaSettings();
  if (!s.enabled && !opts.force) return { sent: 0, accounts: 0, skipped: 'switched off', errors: [] };
  if (!s.apiKey || !s.apiUrl) return { sent: 0, accounts: 0, skipped: 'API URL / key missing', errors: [] };
  if (!s.groupIds.trim() && !s.mobileNos.trim()) return { sent: 0, accounts: 0, skipped: 'no group id or mobile number', errors: [] };

  const sections = await reportSections(s);
  if (!sections.length) {
    const why = `no account expires in the next ${s.days} days or has ${s.limitPercent}% or less sending limit left`;
    log(`${why}, nothing sent`);
    return { sent: 0, accounts: 0, skipped: why, errors: [] };
  }

  const stamp = phpDate('YmdHis');
  const token = randomBytes(8).toString('hex');
  const result: SendResult = { sent: 0, accounts: 0, errors: [] };
  for (const sec of sections) {
    result.accounts += sec.rows.length;
    const pages = Math.ceil(sec.rows.length / ROWS_PER_IMAGE);
    for (let p = 0; p < pages; p++) {
      const from = p * ROWS_PER_IMAGE;
      try {
        const png = await tableImage(sec.title, sec.subtitle + (pages > 1 ? `  |  Page ${p + 1} of ${pages}` : ''), sec.columns, sec.rows.slice(from, from + ROWS_PER_IMAGE), from);
        const fileUrl = await storeBytes(png, 'reports', `${sec.key}-${stamp}-${token}-${p + 1}.png`);
        const lines = sec.textLines.slice(from, from + ROWS_PER_IMAGE).map((l, i) => `${from + i + 1}. ${l}`);
        // 'WA Panel' first so the group sees where the report comes from
        const message = ['*WA Panel*', sec.heading + (pages > 1 ? ` (${p + 1}/${pages})` : ''), '', ...lines].join('\n');
        await postMessage(s, message, fileUrl);
        result.sent++;
      } catch (e) {
        result.errors.push(`${sec.title} page ${p + 1}: ${(e as Error).message}`);
      }
    }
  }
  log(`${sections.map((x) => `${x.title}: ${x.rows.length}`).join('; ')}; ${result.sent} message(s) sent${result.errors.length ? `; errors: ${result.errors.join(' | ')}` : ''}`);
  return result;
}
