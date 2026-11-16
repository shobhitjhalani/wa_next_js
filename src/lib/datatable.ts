/**
 * Server-side DataTables: page, page size, search and sort live in the URL
 * (?page=2&per_page=50&q=…&sort=date&dir=asc) and every page query applies them in SQL,
 * so the browser only ever receives one page. Pure — usable on the server and client.
 *
 *   const t = tableState(params, { sorts: ['date', 'mobile'], sort: 'date' });
 *   const orderBy = { date: 'm_id', mobile: 'm_mobile_no' }[t.sort];   // whitelisted keys only
 */

export const PAGE_SIZES = [10, 25, 50, 100] as const;
export type SortDir = 'asc' | 'desc';
type Params = Record<string, string | string[] | undefined> | URLSearchParams;

export interface TableState<S extends string = string> {
  page: number;
  perPage: number;
  /** Free-text search, trimmed ('' = none). */
  q: string;
  sort: S;
  dir: SortDir;
}

function get(params: Params, key: string): string {
  const v = params instanceof URLSearchParams ? params.get(key) : params[key];
  return (Array.isArray(v) ? v[0] ?? '' : v ?? '').trim();
}

export function tableState<S extends string>(params: Params, opts: {
  /** Sortable column keys; anything else in ?sort= falls back to the default. */
  sorts: readonly S[];
  sort: S;
  dir?: SortDir;
  perPage?: number;
}): TableState<S> {
  const page = parseInt(get(params, 'page'), 10);
  const perPage = parseInt(get(params, 'per_page'), 10);
  const sort = get(params, 'sort') as S;
  const dir = get(params, 'dir');
  const known = opts.sorts.includes(sort);
  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    perPage: (PAGE_SIZES as readonly number[]).includes(perPage) ? perPage : opts.perPage ?? 25,
    q: get(params, 'q').slice(0, 100),
    sort: known ? sort : opts.sort,
    dir: dir === 'asc' || dir === 'desc' ? dir : opts.dir ?? 'desc',
  };
}

/** ORDER BY direction keyword for a validated state (never user text). */
export const sqlDir = (dir: SortDir) => (dir === 'asc' ? 'ASC' : 'DESC');

/** Sort an in-memory list the same way (for reports that are computed in full, e.g. with a totals row). */
export function sortRows<T>(rows: T[], key: (row: T) => string | number | null | undefined, dir: SortDir): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = key(a) ?? '', y = key(b) ?? '';
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
    return c * sign;
  });
}

/** Query string for this table with some keys changed; null / '' removes a key, and page 1 is implicit. */
export function tableHref(path: string, params: Params, changes: Record<string, string | number | null>): string {
  const qs = new URLSearchParams();
  const entries = params instanceof URLSearchParams ? [...params.entries()] : Object.entries(params).flatMap(([k, v]) => (Array.isArray(v) ? v : v === undefined ? [] : [v]).map((x) => [k, x] as [string, string]));
  for (const [k, v] of entries) if (!(k in changes)) qs.append(k, v);
  for (const [k, v] of Object.entries(changes)) if (v !== null && v !== '' && !(k === 'page' && Number(v) === 1)) qs.set(k, String(v));
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}
