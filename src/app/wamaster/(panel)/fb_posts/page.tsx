import type { Metadata } from 'next';
import Link from 'next/link';
import { PageTitle } from '@/components/PageTitle';
import { Pagination, pageParam } from '@/components/Pagination';
import { requireRight } from '@/lib/admin-access';
import { query, value } from '@/lib/db';
import { MAX_CSV_ROWS } from '@/lib/services/fb-posts';
import { phpDate } from '@/lib/time';
import { AccordionCard, type PickPage, RefreshButton, UploadPostsForm } from './Forms';

export const metadata: Metadata = { title: 'Facebook Posts' };

const PER_PAGE = 25;

interface Batch {
  pb_id: number; pb_file: string; pb_total: number; pb_created_on: number; page_names: string[] | null; emp: string | null;
  queued: number; posting: number; posted: number; failed: number; cancelled: number; next_at: number | null;
}

/** Bulk Facebook Page posts from a CSV: upload, then follow each batch's status (super admin). */
export default async function FbPostsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireRight('fb_posts');
  const canAdd = access.can('fb_posts', 'add');
  const params = await searchParams;
  const page = pageParam(params.page);
  const [pages, batches, total] = await Promise.all([
    query<PickPage>(
      `SELECT f.fp_id AS id, f.fp_name AS name, NULLIF(COALESCE(NULLIF(u.u_company_name, ''), u.u_name), '') AS client
         FROM js_fb_page f LEFT JOIN js_user u ON u.u_id = f.fp_user_id ORDER BY lower(f.fp_name)`),
    query<Batch>(
      `SELECT b.pb_id, b.pb_file, b.pb_total, b.pb_created_on, e.emp_name AS emp,
              (SELECT array_agg(f.fp_name ORDER BY lower(f.fp_name)) FROM js_fb_page f
                WHERE f.fp_id IN (SELECT DISTINCT po_page_id FROM js_fb_post WHERE po_batch_id = b.pb_id)) AS page_names,
              COUNT(*) FILTER (WHERE p.po_status = 1)::int AS queued, COUNT(*) FILTER (WHERE p.po_status = 2)::int AS posting,
              COUNT(*) FILTER (WHERE p.po_status = 3)::int AS posted, COUNT(*) FILTER (WHERE p.po_status = 4)::int AS failed,
              COUNT(*) FILTER (WHERE p.po_status = 5)::int AS cancelled, MIN(p.po_scheduled_at) FILTER (WHERE p.po_status = 1) AS next_at
         FROM js_fb_post_batch b
         LEFT JOIN js_employee e ON e.emp_id = b.pb_emp_id
         LEFT JOIN js_fb_post p ON p.po_batch_id = b.pb_id
        GROUP BY b.pb_id, e.emp_name ORDER BY b.pb_id DESC LIMIT ${PER_PAGE} OFFSET ${(page - 1) * PER_PAGE}`),
    value<number>('SELECT COUNT(*)::int FROM js_fb_post_batch'),
  ]);

  return (
    <>
      <PageTitle title="Facebook Posts" home="/wamaster/dashboard" />
      <AccordionCard
        title={<><i className="ri-facebook-circle-fill text-primary me-1" />Bulk post to Facebook Pages</>}
        actions={<>
          <a href="/wamaster/fb_posts/sample" className="btn btn-sm btn-soft-secondary"><i className="ri-download-2-line" /> Sample CSV</a>
          <Link href="/wamaster/fb_posts/pages" className="btn btn-sm btn-soft-primary"><i className="ri-pages-line" /> Pages ({pages.length})</Link>
        </>}
      >
          {!canAdd ? <p className="text-muted mb-0">You can view the uploads; posting needs the Add right.</p> : pages.length ? <UploadPostsForm pages={pages} /> : (
            <div className="alert alert-warning mb-0">Connect a client’s Facebook Page first: <Link href="/wamaster/fb_posts/pages">Pages → Connect Page</Link>.</div>
          )}
          <div className="small text-muted mt-3">
            CSV columns (first row = headings): <code>message</code>, <code>image_url</code> (optional, a public https link; use the Media Library),
            {' '}<code>link</code> (optional), <code>schedule</code> (optional, e.g. 25-11-2026 10:30; empty = as soon as possible). Up to {MAX_CSV_ROWS} posts per file.
            Tick several Pages to publish every row on each of them. Posts go out one by one, about one every two seconds.
          </div>
      </AccordionCard>

      <div className="card">
        <div className="card-header d-flex align-items-center gap-2">
          <h5 className="card-title mb-0 me-auto">Uploads</h5>
          <RefreshButton />
        </div>
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover align-middle table-nowrap mb-0">
              <thead className="table-light"><tr><th>#</th><th>File</th><th>Pages</th><th>Progress</th><th>Status</th><th>Uploaded</th></tr></thead>
              <tbody>
                {batches.length ? batches.map((b) => {
                  const done = b.posted + b.failed + b.cancelled;
                  return (
                    <tr key={b.pb_id}>
                      <td><Link href={`/wamaster/fb_posts/${b.pb_id}`} className="fw-semibold">#{b.pb_id}</Link></td>
                      <td><Link href={`/wamaster/fb_posts/${b.pb_id}`}>{b.pb_file}</Link><div className="small text-muted">{b.pb_total} post(s)</div></td>
                      <td className="small" style={{ maxWidth: 260, whiteSpace: 'normal' }}>
                        {(b.page_names ?? []).slice(0, 3).join(', ')}
                        {(b.page_names?.length ?? 0) > 3 && <span className="text-muted"> +{b.page_names!.length - 3} more</span>}
                        {(b.page_names?.length ?? 0) > 1 && <div className="text-muted">{b.page_names!.length} Pages</div>}
                      </td>
                      <td style={{ minWidth: 160 }}>
                        <div className="progress" style={{ height: 8 }}>
                          <div className="progress-bar bg-success" style={{ width: `${(b.posted / Math.max(1, b.pb_total)) * 100}%` }} />
                          <div className="progress-bar bg-danger" style={{ width: `${(b.failed / Math.max(1, b.pb_total)) * 100}%` }} />
                        </div>
                        <div className="small text-muted mt-1">{done} of {b.pb_total} done</div>
                      </td>
                      <td className="small">
                        <span className="badge bg-success-subtle text-success me-1">{b.posted} posted</span>
                        {b.failed > 0 && <span className="badge bg-danger-subtle text-danger me-1">{b.failed} failed</span>}
                        {b.queued + b.posting > 0 && <span className="badge bg-info-subtle text-info me-1">{b.queued + b.posting} queued</span>}
                        {b.cancelled > 0 && <span className="badge bg-secondary-subtle text-secondary">{b.cancelled} cancelled</span>}
                        {b.next_at && <div className="text-muted mt-1">Next: {phpDate('d M, h:i A', b.next_at)}</div>}
                      </td>
                      <td className="small">{phpDate('d M Y, h:i A', b.pb_created_on)}{b.emp && <div className="text-muted">{b.emp}</div>}</td>
                    </tr>
                  );
                }) : <tr><td colSpan={6} className="text-center text-muted py-5">No uploads yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <Pagination path="/wamaster/fb_posts" params={params} page={page} perPage={PER_PAGE} total={total ?? 0} always />
        </div>
      </div>
    </>
  );
}
