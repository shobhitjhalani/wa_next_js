import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageTitle } from '@/components/PageTitle';
import { ConfirmButton } from '@/components/ui';
import { requireRight } from '@/lib/admin-access';
import { one, query } from '@/lib/db';
import { sp } from '@/lib/http';
import { POST_STATUS } from '@/lib/services/fb-posts';
import { limit } from '@/lib/text';
import { phpDate } from '@/lib/time';
import { cancelQueued, retryFailed } from '../actions';
import { AutoRefresh } from '../Forms';

export const metadata: Metadata = { title: 'Facebook Posts' };

interface Post {
  po_id: number; po_line: number; po_message: string; po_link: string; po_image_url: string; po_scheduled_at: number;
  po_status: number; po_fb_id: string; po_error: string; po_posted_on: number; fp_name: string; fp_page_id: string;
}

/** One CSV upload: every post with its status, Facebook link or error (refreshes while posting). */
export default async function FbBatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireRight('fb_posts');
  const canAdd = access.can('fb_posts', 'add');
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const qs = await searchParams;
  const status = Number(sp(qs, 'status')) || 0;
  const pageFilter = Number(sp(qs, 'page_id')) || 0;
  const batch = await one<{ pb_id: number; pb_file: string; pb_total: number; pb_created_on: number }>(
    'SELECT pb_id, pb_file, pb_total, pb_created_on FROM js_fb_post_batch WHERE pb_id = $1', [id]);
  if (!batch) notFound();
  const [posts, counts, pages] = await Promise.all([
    query<Post>(
      `SELECT p.*, f.fp_name, f.fp_page_id FROM js_fb_post p JOIN js_fb_page f ON f.fp_id = p.po_page_id
        WHERE p.po_batch_id = $1 AND ($2::int = 0 OR p.po_status = $2) AND ($3::int = 0 OR p.po_page_id = $3)
        ORDER BY p.po_line, lower(f.fp_name) LIMIT 2000`, [id, status, pageFilter]),
    query<{ s: number; n: number }>(
      'SELECT po_status AS s, COUNT(*)::int AS n FROM js_fb_post WHERE po_batch_id = $1 AND ($2::int = 0 OR po_page_id = $2) GROUP BY po_status', [id, pageFilter]),
    query<{ fp_id: number; fp_name: string; fp_page_id: string; posted: number; failed: number; total: number }>(
      `SELECT f.fp_id, f.fp_name, f.fp_page_id, COUNT(*) FILTER (WHERE p.po_status = 3)::int AS posted,
              COUNT(*) FILTER (WHERE p.po_status = 4)::int AS failed, COUNT(*)::int AS total
         FROM js_fb_post p JOIN js_fb_page f ON f.fp_id = p.po_page_id WHERE p.po_batch_id = $1
        GROUP BY f.fp_id ORDER BY lower(f.fp_name)`, [id]),
  ]);
  const count = (s: number) => counts.find((c) => Number(c.s) === s)?.n ?? 0;
  const all = counts.reduce((n, c) => n + Number(c.n), 0);
  const multi = pages.length > 1;
  const href = (o: { status?: number; page?: number }) => {
    const q = new URLSearchParams();
    const st = o.status ?? status; const pg = o.page ?? pageFilter;
    if (st) q.set('status', String(st));
    if (pg) q.set('page_id', String(pg));
    return `/wamaster/fb_posts/${id}${q.size ? `?${q}` : ''}`;
  };
  const active = count(1) + count(2) > 0;

  return (
    <>
      <PageTitle title="Facebook Posts" home="/wamaster/dashboard" />
      <div className="mb-3"><Link href="/wamaster/fb_posts" className="text-muted"><i className="ri-arrow-left-line align-middle" /> All uploads</Link></div>
      <div className="card">
        <div className="card-header d-flex flex-wrap align-items-center gap-2">
          <div className="me-auto">
            <h5 className="card-title mb-0">#{batch.pb_id} · {batch.pb_file}</h5>
            <div className="small text-muted">
              To {multi ? `${pages.length} Pages` : pages[0] ? <a href={`https://www.facebook.com/${pages[0].fp_page_id}`} target="_blank" rel="noreferrer">{pages[0].fp_name}</a> : '—'} · uploaded {phpDate('d M Y, h:i A', batch.pb_created_on)}
            </div>
          </div>
          <AutoRefresh active={active} />
          {canAdd && count(4) > 0 && (
            <form action={retryFailed.bind(null, id, pageFilter)}>
              <ConfirmButton message={`Queue the ${count(4)} failed post(s) again?`} className="btn btn-sm btn-soft-warning"><i className="ri-restart-line" /> Retry failed ({count(4)})</ConfirmButton>
            </form>
          )}
          {canAdd && count(1) > 0 && (
            <form action={cancelQueued.bind(null, id, pageFilter)}>
              <ConfirmButton message={`Cancel the ${count(1)} post(s) not published yet?`} className="btn btn-sm btn-soft-danger"><i className="ri-close-circle-line" /> Cancel queued ({count(1)})</ConfirmButton>
            </form>
          )}
        </div>
        <div className="card-body">
          {multi && (
            <div className="d-flex flex-wrap gap-2 mb-2">
              <Link href={href({ page: 0 })} className={`btn btn-sm ${pageFilter ? 'btn-light' : 'btn-soft-primary active'}`}>All Pages</Link>
              {pages.map((pg) => (
                <Link key={pg.fp_id} href={href({ page: pg.fp_id })} className={`btn btn-sm ${pageFilter === pg.fp_id ? 'btn-soft-primary active' : 'btn-light'}`}>
                  {pg.fp_name} <span className="text-success">{pg.posted}</span>/{pg.total}{pg.failed > 0 && <span className="text-danger"> · {pg.failed} failed</span>}
                </Link>
              ))}
            </div>
          )}
          <div className="d-flex flex-wrap gap-2 mb-3">
            <Link href={href({ status: 0 })} className={`btn btn-sm ${status ? 'btn-light' : 'btn-primary'}`}>All ({all})</Link>
            {[1, 2, 3, 4, 5].filter((s) => count(s)).map((s) => (
              <Link key={s} href={href({ status: s })} className={`btn btn-sm ${status === s ? 'btn-primary' : 'btn-light'}`}>{POST_STATUS[s].label} ({count(s)})</Link>
            ))}
          </div>
          <div className="table-responsive">
            <table className="table align-middle mb-0">
              <thead className="table-light"><tr><th>Line</th>{multi && <th>Page</th>}<th>Post</th><th>Scheduled</th><th>Status</th><th>Result</th></tr></thead>
              <tbody>
                {posts.length ? posts.map((p) => {
                  const st = POST_STATUS[p.po_status] ?? POST_STATUS[1];
                  return (
                    <tr key={p.po_id}>
                      <td className="text-muted">{p.po_line}</td>
                      {multi && <td className="small"><a href={`https://www.facebook.com/${p.fp_page_id}`} target="_blank" rel="noreferrer">{p.fp_name}</a></td>}
                      <td style={{ maxWidth: 480 }}>
                        <div className="d-flex gap-2">
                          {p.po_image_url && <a href={p.po_image_url} target="_blank" rel="noreferrer"><img src={p.po_image_url} alt="" width={56} height={56} className="rounded border flex-none" style={{ objectFit: 'cover' }} /></a>}
                          <div className="min-w-0">
                            <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{limit(p.po_message, 220) || <span className="text-muted">(image only)</span>}</div>
                            {p.po_link && <a href={p.po_link} target="_blank" rel="noreferrer" className="small text-break"><i className="ri-link" /> {p.po_link}</a>}
                          </div>
                        </div>
                      </td>
                      <td className="small text-nowrap">{phpDate('d M, h:i A', p.po_scheduled_at)}</td>
                      <td><span className={`badge ${st.badge}`}>{st.label}</span></td>
                      <td className="small" style={{ maxWidth: 320 }}>
                        {p.po_status === 3 && p.po_fb_id
                          ? <><a href={`https://www.facebook.com/${p.po_fb_id}`} target="_blank" rel="noreferrer"><i className="ri-external-link-line" /> View on Facebook</a><div className="text-muted">{phpDate('d M, h:i A', p.po_posted_on)}</div></>
                          : p.po_error ? <span className="text-danger">{p.po_error}</span> : <span className="text-muted">—</span>}
                      </td>
                    </tr>
                  );
                }) : <tr><td colSpan={multi ? 6 : 5} className="text-center text-muted py-4">No posts with this status.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
