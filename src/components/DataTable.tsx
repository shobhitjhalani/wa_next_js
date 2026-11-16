import Link from 'next/link';
import type { ReactNode } from 'react';
import { tableHref, type SortDir, type TableState } from '@/lib/datatable';

export { DataTableControls } from './DataTableControls';

type Params = Record<string, string | string[] | undefined>;

/** The current query string, for <DataTableControls query=…>. */
export function queryString(params: Params): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) for (const item of Array.isArray(v) ? v : v === undefined ? [] : [v]) qs.append(k, item);
  return qs.toString();
}

/** Sortable column header: a link that toggles ascending / descending (first click uses `first`). */
export function SortTh({ path, params, state, column, first = 'asc', className, children }: {
  path: string; params: Params; state: Pick<TableState, 'sort' | 'dir'>; column: string; first?: SortDir; className?: string; children: ReactNode;
}) {
  const active = state.sort === column;
  const next: SortDir = active ? (state.dir === 'asc' ? 'desc' : 'asc') : first;
  const icon = active ? (state.dir === 'asc' ? 'ri-arrow-up-s-fill' : 'ri-arrow-down-s-fill') : 'ri-expand-up-down-line opacity-50';
  return (
    <th className={className} aria-sort={active ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <Link href={tableHref(path, params, { sort: column, dir: next, page: null })} className="text-reset text-decoration-none d-inline-flex align-items-center gap-1 sort-th" scroll={false}>
        {children}<i className={icon} aria-hidden />
      </Link>
    </th>
  );
}

/** Hidden inputs for an existing GET filter form, so submitting it keeps the table's size / search / sort. */
export function DataTableHidden({ state, defaults }: {
  state: TableState;
  /** Values equal to these are left out of the URL. */
  defaults: { perPage: number; sort: string; dir: SortDir };
}) {
  const { perPage, q, sort, dir } = state;
  return (
    <>
      {perPage !== defaults.perPage && <input type="hidden" name="per_page" value={perPage} />}
      {q && <input type="hidden" name="q" value={q} />}
      {(sort !== defaults.sort || dir !== defaults.dir) && <><input type="hidden" name="sort" value={sort} /><input type="hidden" name="dir" value={dir} /></>}
    </>
  );
}
