// Search params helpers. The PHP pages kept filters in $_SESSION after a POST;
// here filters live in the URL (GET), so a filtered page can be bookmarked/shared.
import { currentMonthDmy } from "./format";

export type SearchParams = Record<string, string | string[] | undefined>;

export const str = (sp: SearchParams, key: string): string => {
  const v = sp[key];
  return (Array.isArray(v) ? v[0] : v ?? "").trim();
};

export const int = (sp: SearchParams, key: string): number | undefined => {
  const v = str(sp, key);
  if (!/^-?\d+$/.test(v)) return undefined;
  return Number(v);
};

export const page = (sp: SearchParams) => Math.max(1, int(sp, "curpage") ?? 1);

/**
 * Message reports default to the current month: counting all of js_message (3M+ rows)
 * on every visit is slow. A submitted empty date (wa_date=) still means "all time".
 */
export const withMonthDefault = (sp: SearchParams): SearchParams =>
  "wa_date" in sp ? sp : { ...sp, wa_date: currentMonthDmy() };

/** Keys whose empty value is meaningful and must survive in links (empty wa_date = all time). */
const KEEP_EMPTY = new Set(["wa_date"]);

/** Rebuilds a query string from current params with overrides (undefined/"" drops a key). */
export function qs(sp: SearchParams, overrides: Record<string, string | number | undefined> = {}): string {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (val !== undefined && (val !== "" || KEEP_EMPTY.has(k)) && !(k in overrides)) out.set(k, val);
  }
  for (const [k, v] of Object.entries(overrides)) if (v !== undefined && v !== "") out.set(k, String(v));
  const s = out.toString();
  return s ? `?${s}` : "";
}
