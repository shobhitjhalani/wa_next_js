/**
 * Date helpers in the app time zone (process TZ, Asia/Kolkata by default).
 * Dates in the legacy schema are unix seconds; these mirror the PHP date() /
 * strtotime() calls the Laravel app used.
 */

/** Current unix time in seconds (PHP time()). */
export function now(): number {
  return Math.floor(Date.now() / 1000);
}

/** Unix time of local midnight of the given time (PHP strtotime(date('Y-m-d', $ts))). */
export function dayStart(ts: number = now()): number {
  const d = new Date(ts * 1000);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

/** First second of the month of the given time (PHP strtotime(date('Y-m-01'))). */
export function monthStart(ts: number = now()): number {
  const d = new Date(ts * 1000);
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return Math.floor(d.getTime() / 1000);
}

/** Add whole days to a unix time, keeping the local clock time. */
export function addDays(ts: number, days: number): number {
  const d = new Date(ts * 1000);
  d.setDate(d.getDate() + days);
  return Math.floor(d.getTime() / 1000);
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/**
 * PHP date() formatting for the format characters the app uses:
 * d D j l N w F m M n t Y y a A g G h H i s U. A backslash escapes a character.
 */
export function phpDate(format: string, ts: number | Date = now()): string {
  const d = ts instanceof Date ? ts : new Date(ts * 1000);
  let out = '';
  for (let i = 0; i < format.length; i++) {
    const c = format[i];
    if (c === '\\') {
      out += format[++i] ?? '';
      continue;
    }
    const h = d.getHours();
    switch (c) {
      case 'd': out += pad(d.getDate()); break;
      case 'D': out += DAYS[d.getDay()].slice(0, 3); break;
      case 'j': out += d.getDate(); break;
      case 'l': out += DAYS[d.getDay()]; break;
      case 'N': out += d.getDay() || 7; break;
      case 'w': out += d.getDay(); break;
      case 'F': out += MONTHS[d.getMonth()]; break;
      case 'm': out += pad(d.getMonth() + 1); break;
      case 'M': out += MONTHS[d.getMonth()].slice(0, 3); break;
      case 'n': out += d.getMonth() + 1; break;
      case 't': out += new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); break;
      case 'Y': out += d.getFullYear(); break;
      case 'y': out += pad(d.getFullYear() % 100); break;
      case 'a': out += h < 12 ? 'am' : 'pm'; break;
      case 'A': out += h < 12 ? 'AM' : 'PM'; break;
      case 'g': out += h % 12 || 12; break;
      case 'G': out += h; break;
      case 'h': out += pad(h % 12 || 12); break;
      case 'H': out += pad(h); break;
      case 'i': out += pad(d.getMinutes()); break;
      case 's': out += pad(d.getSeconds()); break;
      case 'U': out += Math.floor(d.getTime() / 1000); break;
      default: out += c;
    }
  }
  return out;
}

/**
 * Parse the date formats the forms send into unix seconds (local time):
 * "07-10-2026", "2026-10-07", "2026-10-07 14:30[:00]", "2026-10-07T14:30"
 * (datetime-local). Returns null when unparseable.
 */
export function parseDate(value: string | null | undefined): number | null {
  const v = String(value ?? '').trim();
  let m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  let y: number, mo: number, d: number, H = 0, i = 0, s = 0;
  if (m) {
    [d, mo, y] = [+m[1], +m[2], +m[3]];
    [H, i, s] = [+(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)];
  } else {
    m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!m) return null;
    [y, mo, d] = [+m[1], +m[2], +m[3]];
    [H, i, s] = [+(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)];
  }
  const date = new Date(y, mo - 1, d, H, i, s);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return Math.floor(date.getTime() / 1000);
}

/** Unix seconds of a "Y-m-d H:i:s" timestamp column value. */
export function timestampToUnix(value: string | null | undefined): number {
  if (!value) return 0;
  return parseDate(String(value).slice(0, 19)) ?? 0;
}

/**
 * The flatpickr range filter ("07-10-2026" or "01-10-2026 to 07-10-2026")
 * as [start, end-exclusive] unix bounds; null when empty or invalid.
 */
export function parseDateRange(value: string | null | undefined): [number, number] | null {
  const v = String(value ?? '').trim();
  if (!v) return null;
  const parts = v.split(' to ').map((p) => p.trim());
  const start = parseDate(parts[0]);
  const end = parseDate(parts[1] ?? parts[0]);
  if (start === null || end === null) return null;
  return [start, addDays(end, 1)];
}

/** Today as the range filter shows it ("d-m-Y"). */
export function todayString(): string {
  return phpDate('d-m-Y');
}

/** Short timestamp for lists: time today, "Yesterday", weekday this week, else the date. */
export function shortTime(ts: number): string {
  if (!ts || ts <= 0) return '';
  const day = dayStart(ts);
  const today = dayStart();
  if (day === today) return phpDate('H:i', ts);
  if (day === addDays(today, -1)) return 'Yesterday';
  if (day > addDays(today, -6)) return phpDate('l', ts);
  return phpDate('d/m/y', ts);
}

/** Hour of day (0–23) at `at` in an IANA time zone, independent of the process TZ. */
export function hourIn(at: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone }).format(at));
}

/** True when `at` falls in [startHour, endHour) in the given time zone. */
export function withinHours(at: Date, startHour: number, endHour: number, timeZone: string): boolean {
  const hour = hourIn(at, timeZone);
  return hour >= startHour && hour < endHour;
}
