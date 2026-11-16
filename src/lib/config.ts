import path from 'node:path';

/**
 * App settings, read once from the environment. Port of the Laravel
 * config/wa.php (which replaced the legacy config/general.php constants).
 * Secrets live in .env only.
 */

const env = (key: string, fallback = ''): string => process.env[key] ?? fallback;
const int = (key: string, fallback: number): number => {
  const n = parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};
/** '08:00-23:00/30, 23:30' → ['08:00', '08:30', …, '23:00', '23:30'] */
function reportTimes(spec: string): string[] {
  const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
  const out = new Set<string>();
  for (const part of spec.split(',').map((v) => v.trim()).filter(Boolean)) {
    const r = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*\/\s*(\d+)$/.exec(part);
    if (r) {
      const step = Math.max(5, parseInt(r[3], 10));
      for (let t = toMin(r[1]); t <= toMin(r[2]); t += step) out.add(hhmm(t));
    } else if (/^\d{1,2}:\d{2}$/.test(part)) out.add(hhmm(toMin(part)));
  }
  return [...out].sort();
}
const dir = (key: string, fallback: string): string => path.resolve(/* turbopackIgnore: true */ process.cwd(), env(key, fallback));

export const config = {
  appName: env('APP_NAME', 'JS Coretech'),
  appUrl: env('APP_URL', 'http://localhost:3000').replace(/\/+$/, ''),
  timezone: env('TZ', 'Asia/Kolkata'),
  sessionSecret: env('SESSION_SECRET'),
  sessionHours: int('SESSION_HOURS', 12),

  databaseUrl: env('DATABASE_URL', 'postgres://localhost:5432/wa_next'),
  dbPoolMax: int('DB_POOL_MAX', 20),

  site: {
    supportNo: env('SITE_SUPPORT_NO'),
    supportEmail: env('SITE_SUPPORT_EMAIL'),
    fYear: env('F_YEAR', '23-24'),
    pageSize: 100,
  },

  meta: {
    apiUrl: env('WA_API_URL', 'https://graph.facebook.com/v25.0/').replace(/\/+$/, '') + '/',
    // Fallback token. The legacy app read the live token from js_master_value; when that row exists it wins.
    key: env('WA_KEY'),
    keyMasterId: int('WA_KEY_MASTER_ID', 56203),
    webhookVerifyToken: env('WA_WEBHOOK_VERIFY_TOKEN'),
    appSecret: env('META_APP_SECRET'),
    fbAppId: env('FB_APP_ID'),
    fbConfigId: env('FB_CONFIG_ID'),
    registerPin: env('WA_REGISTER_PIN', ''),
  },

  countryCode: env('WA_COUNTRY_CODE', '91'),

  // Queue sender only runs between these hours (legacy cron: 7–23)
  sendStartHour: int('WA_SEND_START_HOUR', 7),
  sendEndHour: int('WA_SEND_END_HOUR', 23),
  sendBatch: int('WA_SEND_BATCH', 1000),
  sendConcurrency: Math.max(1, int('WA_SEND_CONCURRENCY', 16)),
  // Messages older than this (seconds) are no longer considered "in queue" (legacy QUE_TIME)
  queTime: int('WA_QUE_TIME', 259200),
  // Outgoing messages older than this (seconds, by m_created_on) are never sent; they expire (status 5)
  messageExpiry: int('WA_MSG_EXPIRY', 86400),
  // Queued messages older than this many days are system-cancelled
  cancelAfterDays: 10,

  // Files Meta must fetch by URL (legacy public/media), served by /media/[...path]
  mediaPath: dir('MEDIA_PATH', './storage/media'),
  mediaUrl: '/media',
  // Base64 attachment payloads saved by the API (legacy waapi/media)
  apiMediaPath: dir('API_MEDIA_PATH', './storage/api_media'),

  payment: {
    // 1 = Razorpay, 2 = CCAvenue (legacy p_gateway)
    gateway: int('PAYMENT_GATEWAY', 2),
    gstPercent: 18,
    razorpayKey: env('RAZORPAY_KEY'),
    razorpaySecret: env('RAZORPAY_SECRET'),
    ccaMerchantId: env('CCA_MERCHANT_ID'),
    ccaAccessCode: env('CCA_ACCESS_CODE'),
    ccaWorkingKey: env('CCA_WORKING_KEY'),
    ccaUrl: env('CCA_URL', 'https://secure.ccavenue.com/transaction/transaction.do?command=initiateTransaction'),
  },

  // Shopify order webhooks (legacy waapi/shopify.php, hardwired to user 74)
  shopify: {
    userId: int('SHOPIFY_USER_ID', 74),
    webhookSecret: env('SHOPIFY_WEBHOOK_SECRET'),
    templates: {
      new_order: env('SHOPIFY_ORDER_TEMPLATE', 'order_confirmation'),
      abandoned_cart: env('SHOPIFY_CART_TEMPLATE', 'abandoned_checkout'),
    } as Record<string, string>,
  },

  // Shared key the legacy waapi/client_api.php required in its Api-Key header ('' = not checked)
  clientApiKey: env('CLIENT_API_KEY'),

  // SMTP_* (SMTP_URL, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, SMTP_EMAIL_FROM) win over MAIL_*;
  // MAIL_MAILER=log prints mails to the worker log instead of sending
  mail: {
    mailer: env('MAIL_MAILER', 'log'),
    host: env('SMTP_URL').replace(/^smtps?:\/\//, '') || env('MAIL_HOST', '127.0.0.1'),
    port: int('SMTP_PORT', int('MAIL_PORT', 2525)),
    username: env('SMTP_USERNAME') || env('MAIL_USERNAME'),
    password: env('SMTP_PASSWORD') || env('MAIL_PASSWORD'),
    // 465 is implicit TLS; 587 / 2525 upgrade with STARTTLS
    secure: env('MAIL_SECURE') === 'true' || int('SMTP_PORT', int('MAIL_PORT', 2525)) === 465,
    fromAddress: env('SMTP_EMAIL_FROM') || env('MAIL_FROM_ADDRESS', 'hello@example.com'),
    fromName: env('MAIL_FROM_NAME', env('APP_NAME', 'JS Coretech')),
  },

  // Daily email reports (legacy cron/email.php and cron/user_email.php)
  reports: {
    adminEmail: env('REPORT_ADMIN_EMAIL'),
    bcc: env('REPORT_BCC_EMAIL'),
    templateUsers: env('REPORT_TEMPLATE_USERS', '46')
      .split(',')
      .map((v) => parseInt(v, 10))
      .filter((n) => n > 0),
    // REPORT_EMAIL_TIMES: 'HH:MM' times and / or 'HH:MM-HH:MM/minutes' ranges, comma separated
    // (e.g. 08:00-23:00/30 = every 30 minutes from 8 AM to 11 PM); falls back to REPORT_EMAIL_TIME
    times: reportTimes(env('REPORT_EMAIL_TIMES') || env('REPORT_EMAIL_TIME', '23:30')),
  },

  // Database backups to DigitalOcean Spaces (src/lib/services/backup.ts)
  backup: {
    // DO_SPACES_ACCESS_KEY / _SECRET_KEY / _PREFIX and BACKUP_RETENTION_DAYS are accepted too
    key: env('DO_SPACES_KEY') || env('DO_SPACES_ACCESS_KEY'),
    secret: env('DO_SPACES_SECRET') || env('DO_SPACES_SECRET_KEY'),
    bucket: env('DO_SPACES_BUCKET'),
    region: env('DO_SPACES_REGION', 'blr1'),
    endpoint: env('DO_SPACES_ENDPOINT'),
    prefix: (env('BACKUP_PREFIX') || env('DO_SPACES_PREFIX') || 'db-backups/').replace(/^\/+/, '').replace(/\/*$/, '/'),
    keepDays: Math.max(1, int('BACKUP_KEEP_DAYS', int('BACKUP_RETENTION_DAYS', 14))),
    /** Local times (TZ) of the automatic backups. */
    times: env('BACKUP_TIMES', '00:00').split(',').map((t) => t.trim()).filter((t) => /^\d{1,2}:\d{2}$/.test(t)),
    pgDump: env('PG_DUMP_PATH', 'pg_dump'),
    /** WAL-G base-backup list written by the weekly wal-g-base-backup job (server only). */
    walgStatus: env('WALG_STATUS_FILE', '/var/www/wa/shared/walg/status.json'),
  },

  // Master heading ids used by the app (js_master_heading)
  masters: {
    country: 42,
    state: 43,
    city: 44,
    waPlan: 82,
    userType: 94,
    paymentGateway: 95,
    sheetType: 96,
    teamRole: 101,
  },

  messageStatus: {
    1: 'In Que',
    3: 'Send',
    4: 'Cancelled',
    5: 'System Cancelled',
    6: 'Processing',
    7: 'Invalid Mobile No',
    8: 'Re-Send',
    9: 'Opt Out',
  } as Record<number, string>,

  deliveryStatus: {
    sent: 'Sent',
    delivered: 'Delivered',
    read: 'Read',
    failed: 'Failed',
  } as Record<string, string>,

  // Plan types (mv_value1 on a WhatsApp Plan master value)
  planTypes: {
    1: 'Add On Plan',
    2: 'Validity Plan',
    3: 'Trial Plan',
  } as Record<number, string>,

  // Incoming texts that opt a contact out (legacy fun_incoming_msg)
  optOutKeywords: ['stop', 'opt out', 'stop promotion', 'stop promotions'] as string[],
} as const;

/** Absolute URL for a path on this app (Laravel url()). */
export function url(p: string): string {
  return config.appUrl + (p.startsWith('/') ? p : '/' + p);
}
