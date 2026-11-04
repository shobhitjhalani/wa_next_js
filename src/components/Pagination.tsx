import Link from 'next/link';
import { numberFormat } from '@/lib/text';

/**
 * Laravel-style Bootstrap 5 paginator ("Showing 1 to 100 of 2,345 results"
 * + page links). Keeps the current filters in the links.
 *
 *   <Pagination path="/reports" params={sp} page={page} perPage={100} total={total} />
 *
 * Pass total = null for simple "Previous / Next" paging when counting is too
 * expensive; then pass hasMore.
 */
export function Pagination({ path, params, page, perPage, total, hasMore }: {
  path: string;
  params: Record<string, string | string[] | undefined>;
  page: number;
  perPage: number;
  total: number | null;
  hasMore?: boolean;
}) {
  const last = total === null ? (hasMore ? page + 1 : page) : Math.max(1, Math.ceil(total / perPage));
  const href = (p: number) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (k === 'page' || v === undefined) continue;
      for (const item of Array.isArray(v) ? v : [v]) qs.append(k, item);
    }
    if (p > 1) qs.set('page', String(p));
    const s = qs.toString();
    return s ? `${path}?${s}` : path;
  };
  if (total !== null && total <= perPage && page <= 1) return null;
  if (total === null && !hasMore && page <= 1) return null;

  const pages: (number | '…')[] = [];
  if (total !== null) {
    const window = 3;
    for (let p = 1; p <= last; p++) {
      if (p <= 2 || p > last - 2 || Math.abs(p - page) <= window) pages.push(p);
      else if (pages[pages.length - 1] !== '…') pages.push('…');
    }
  }
  const from = (page - 1) * perPage + 1;
  const to = total === null ? page * perPage : Math.min(total, page * perPage);
  // Past the last page (e.g. ?page=9 or rows deleted since): Laravel's "0 of N results"
  const outOfRange = total !== null && from > total;

  return (
    <nav className="d-flex justify-items-center justify-content-between mt-3">
      <div className="d-flex justify-content-between flex-fill d-sm-none">
        <ul className="pagination">
          <li className={`page-item${page <= 1 ? ' disabled' : ''}`}><Link className="page-link" href={href(page - 1)}>&laquo; Previous</Link></li>
          <li className={`page-item${page >= last ? ' disabled' : ''}`}><Link className="page-link" href={href(page + 1)}>Next &raquo;</Link></li>
        </ul>
      </div>
      <div className="d-none flex-sm-fill d-sm-flex align-items-sm-center justify-content-sm-between">
        <div>
          <p className="small text-muted mb-0">
            Showing {outOfRange
              ? <span className="fw-semibold">0</span>
              : <><span className="fw-semibold">{numberFormat(from)}</span> to <span className="fw-semibold">{numberFormat(to)}</span></>}
            {total !== null && <> of <span className="fw-semibold">{numberFormat(total)}</span></>} results
          </p>
        </div>
        <div>
          <ul className="pagination mb-0">
            <li className={`page-item${page <= 1 ? ' disabled' : ''}`}>
              <Link className="page-link" href={href(page - 1)} aria-label="Previous">&lsaquo;</Link>
            </li>
            {pages.map((p, i) => p === '…'
              ? <li key={`e${i}`} className="page-item disabled"><span className="page-link">…</span></li>
              : <li key={p} className={`page-item${p === page ? ' active' : ''}`}><Link className="page-link" href={href(p)}>{p}</Link></li>)}
            <li className={`page-item${page >= last ? ' disabled' : ''}`}>
              <Link className="page-link" href={href(page + 1)} aria-label="Next">&rsaquo;</Link>
            </li>
          </ul>
        </div>
      </div>
    </nav>
  );
}

/** Current page number from searchParams (≥ 1). */
export function pageParam(v: string | string[] | undefined): number {
  const n = parseInt(Array.isArray(v) ? v[0] : (v ?? '1'), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
