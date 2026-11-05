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
  sendBatch: int('WA_SEND_BATCH', 100),
  sendConcurrency: Math.max(1, int('WA_SEND_CONCURRENCY', 8)),
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

  mail: {
    mailer: env('MAIL_MAILER', 'log'),
    host: env('MAIL_HOST', '127.0.0.1'),
    port: int('MAIL_PORT', 2525),
    username: env('MAIL_USERNAME'),
    password: env('MAIL_PASSWORD'),
    secure: env('MAIL_SECURE') === 'true',
    fromAddress: env('MAIL_FROM_ADDRESS', 'hello@example.com'),
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
    time: env('REPORT_EMAIL_TIME', '23:30'),
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
