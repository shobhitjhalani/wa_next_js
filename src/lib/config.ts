// Replaces config/general.php. Secrets come from the environment, never from code.

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export const config = {
  siteUrl: env("SITE_URL", "http://localhost:3000/"),
  siteName: env("SITE_NAME", "JS Coretech"),
  mediaUrl: env("MEDIA_URL", "/media/"),
  assetsUrl: "/common_assets/",
  pageSize: 20,
  supportNo: env("SUPPORT_NO", ""),
  supportEmail: env("SUPPORT_EMAIL", ""),
  timezone: "Asia/Kolkata",

  wa: {
    apiUrl: env("WA_API_URL", "https://graph.facebook.com/v25.0/"),
    key: process.env.WA_KEY ?? "",
    wabaId: process.env.WABA_ID ?? "",
    webhookVerifyToken: process.env.WA_WEBHOOK_VERIFY_TOKEN ?? "",
    queTime: Number(env("QUE_TIME", "259200")),
  },
} as const;

/** Unix time in seconds, matching PHP time() used throughout the existing data. */
export const now = () => Math.floor(Date.now() / 1000);

/** Wall-clock parts in Asia/Kolkata (PHP ran with that default timezone). */
export function istParts(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return {
    yymmdd: `${p.year.slice(2)}${p.month}${p.day}`,
    hour: Number(p.hour),
    /** Unix time of today's 00:00 IST — PHP strtotime(date('d-m-Y')). */
    startOfDay: Math.floor(Date.UTC(+p.year, +p.month - 1, +p.day) / 1000) - 5.5 * 3600,
  };
}
