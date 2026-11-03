// Small helpers shared by the user panel pages: PHP-style date formatting in
// Asia/Kolkata, the d-m-Y date-range filter, and the status labels from applicationtop.php.

const IST_OFFSET = 5.5 * 3600;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** PHP date() for the handful of tokens the PHP pages use (d m M y Y H i s), in IST. */
export function phpDate(format: string, unix: number | bigint | null | undefined): string {
  const t = Number(unix ?? 0);
  if (!t) return "";
  const d = new Date((t + IST_OFFSET) * 1000); // read UTC fields = IST wall clock
  const pad = (n: number) => String(n).padStart(2, "0");
  const map: Record<string, string> = {
    d: pad(d.getUTCDate()),
    m: pad(d.getUTCMonth() + 1),
    M: MONTHS[d.getUTCMonth()],
    y: pad(d.getUTCFullYear() % 100),
    Y: String(d.getUTCFullYear()),
    H: pad(d.getUTCHours()),
    i: pad(d.getUTCMinutes()),
    s: pad(d.getUTCSeconds()),
  };
  return format.replace(/[dmMyYHis]/g, (c) => map[c]);
}

export const toUnix = (d: Date | null | undefined) => (d ? Math.floor(d.getTime() / 1000) : 0);

/** strtotime('d-m-Y') in IST. Returns 0 for anything unparseable. */
export function parseDmy(s: string): number {
  const m = s.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!m) return 0;
  return Math.floor(Date.UTC(+m[3], +m[2] - 1, +m[1]) / 1000) - IST_OFFSET;
}

export function todayDmy(): string {
  return phpDate("d-m-Y", Math.floor(Date.now() / 1000));
}

/**
 * The PHP filter: "d-m-Y" or "d-m-Y to d-m-Y" -> m_created_on range.
 * The end is inclusive of the whole last day (+86400), exactly like the PHP pages.
 */
export function dateRange(value: string): { gte: number; lte: number } | null {
  if (!value.trim()) return null;
  const [a, b] = value.split(" to ");
  const from = parseDmy(a);
  if (!from) return null;
  const to = (b ? parseDmy(b) : from) || from;
  return { gte: from, lte: to + 86400 };
}

/** Today 00:00 IST as unix time (PHP strtotime(date('d-m-Y'))). */
export const startOfTodayIst = () => parseDmy(todayDmy());

// applicationtop.php
export const WA_STATUS: Record<number, string> = {
  1: "In Que",
  3: "Send ",
  4: "Cancelled",
  5: "System Cancelled",
  6: "Processing",
  7: "Invalid Mobile No",
  8: "Re-Send",
  9: "Opt Out",
};

export const WA_DELIVERY_STATUS: Record<string, string> = {
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
  failed: "Failed",
};

export const PA_STATUS: Record<string, string> = { "1": "Active", "2": "Inactive" };

/** The PHP app stored ' and " as HTML entities; show them as characters. */
export const decodeEntities = (s: string | null | undefined) =>
  (s ?? "").replace(/&#39;/g, "'").replace(/&#34;/g, '"');

/** Encode like the PHP save helpers did, so rows stay readable by both apps. */
export const phpEscape = (s: string) => s.replace(/'/g, "&#39;").replace(/"/g, "&#34;");

/** Common::fun_json_decode(): entity-decode, strip control/high bytes, JSON.parse. */
export function phpJsonDecode<T = unknown>(s: string | null | undefined): T | null {
  if (!s) return null;
  const v = decodeEntities(s).replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[\x00-\x1F]/g, "");
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}

export function messagePreview(content: string | null, templateName: string | null, templatePara: string | null): string {
  let sms = decodeEntities(content);
  if (sms === "") {
    sms = ` Template : ${templateName ?? ""}`;
    if (templatePara) sms += ` : ${templatePara}`;
  }
  return sms;
}

export const PAGE_SIZE = 100;

/** Reads ?curpage, as the PHP pager did. */
export function curPage(sp: Record<string, string | string[] | undefined>): number {
  const n = Number(Array.isArray(sp.curpage) ? sp.curpage[0] : sp.curpage);
  return Number.isFinite(n) && n > 1 ? Math.floor(n) : 1;
}

export const param = (sp: Record<string, string | string[] | undefined>, k: string): string => {
  const v = sp[k];
  return (Array.isArray(v) ? v[0] : v) ?? "";
};
