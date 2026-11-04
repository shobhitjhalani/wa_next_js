/**
 * String helpers mirroring the PHP functions the legacy data depends on
 * (stored text is often HTML-entity encoded by the old app).
 */

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'",
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—',
  hellip: '…', bull: '•', copy: '©', reg: '®', trade: '™', rupee: '₹',
};

/** PHP html_entity_decode($s, ENT_QUOTES). */
export function decodeEntities(input: unknown): string {
  const s = input == null ? '' : String(input);
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return NAMED[code.toLowerCase()] ?? NAMED[code] ?? m;
  });
}

/** Escape for HTML (Blade {{ }} / PHP e()). */
export function escapeHtml(input: unknown): string {
  return String(input ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]!);
}

/** Laravel Str::limit($s, $limit, $end): cut to `limit` characters and append `end` when cut. */
export function limit(input: unknown, max: number, end = '...'): string {
  const chars = Array.from(String(input ?? ''));
  return chars.length <= max ? chars.join('') : chars.slice(0, max).join('').trimEnd() + end;
}

/** PHP ucfirst. */
export function ucfirst(s: unknown): string {
  const v = String(s ?? '');
  return v.charAt(0).toUpperCase() + v.slice(1);
}

/** PHP number_format($n, $decimals): 1234567.8 → "1,234,568". */
export function numberFormat(n: unknown, decimals = 0): string {
  const v = Number(n ?? 0);
  return (Number.isFinite(v) ? v : 0).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Random alphanumeric string (Laravel Str::random). */
export function randomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

/** Safe JSON.parse: returns fallback on error / empty input. */
export function jsonParse<T>(input: unknown, fallback: T): T {
  if (input == null || input === '') return fallback;
  if (typeof input === 'object') return input as T;
  try {
    const v = JSON.parse(String(input));
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/** Value as a trimmed string ('' for null / undefined). */
export function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

/** Value as an integer (0 when not numeric), like PHP (int). */
export function int(v: unknown): number {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : 0;
}
