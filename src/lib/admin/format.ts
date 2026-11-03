// PHP date() formats used by the admin pages, rendered in Asia/Kolkata.
const TZ = "Asia/Kolkata";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(ts: number) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(ts * 1000)).map((x) => [x.type, x.value]),
  );
  return { d: p.day, m: p.month, M: MON[Number(p.month) - 1], Y: p.year, y: p.year.slice(2), H: p.hour, i: p.minute, s: p.second };
}

/** Formats a unix timestamp like PHP date(); supports d m M Y y H i s. Empty for 0/null. */
export function phpDate(format: string, ts: number | bigint | null | undefined): string {
  const t = Number(ts ?? 0);
  if (!t) return "";
  const p = parts(t);
  return format.replace(/[dmMYyHis]/g, (c) => p[c as keyof typeof p]);
}

/** Midnight IST of a "d-m-Y" string (PHP strtotime('d-m-Y') with Asia/Kolkata). */
export function istDayStart(dmy: string): number | null {
  const m = dmy.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!m) return null;
  return Math.floor(Date.UTC(+m[3], +m[2] - 1, +m[1]) / 1000) - 5.5 * 3600;
}

/** Today in d-m-Y (IST). */
export const todayDmy = () => phpDate("d-m-Y", Math.floor(Date.now() / 1000));

/** Current month (IST) as a flatpickr range, e.g. "01-11-2026 to 30-11-2026". */
export function currentMonthDmy(): string {
  const [m, y] = phpDate("m-Y", Math.floor(Date.now() / 1000)).split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return `01-${mm}-${y} to ${lastDay}-${mm}-${y}`;
}

/**
 * Parses the flatpickr range "d-m-Y to d-m-Y" into [from, to) unix bounds,
 * matching the PHP pages (end day inclusive: +86400).
 */
export function dateRange(value: string | undefined): { gte: number; lte: number } | null {
  if (!value) return null;
  const [a, b] = value.split(" to ");
  const from = istDayStart(a ?? "");
  if (from === null) return null;
  const to = istDayStart(b ?? "") ?? from;
  return { gte: from, lte: to + 86400 };
}

export const ucfirst = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

export const numberFormat = (n: number | string | null | undefined, decimals = 0) =>
  Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/** Undo the &#39; / &#34; escaping PHP stored in text columns. */
export const unescapeHtml = (s: string | null | undefined) => (s ?? "").replace(/&#39;/g, "'").replace(/&#34;/g, '"');
