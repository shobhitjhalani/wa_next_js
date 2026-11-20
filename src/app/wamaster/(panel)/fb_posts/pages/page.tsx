import type { Metadata } from 'next';
import Link from 'next/link';
import { PageTitle } from '@/components/PageTitle';
import { ConfirmButton } from '@/components/ui';
import { requireRight } from '@/lib/admin-access';
import { query } from '@/lib/db';
import { phpDate } from '@/lib/time';
import { deletePage } from '../actions';
import { AddPageForm } from '../Forms';

export const metadata: Metadata = { title: 'Facebook Pages' };

/** Client Facebook Pages the admin can bulk-post to (super admin). */
export default async function FbPagesPage() {
  const access = await requireRight('fb_posts');
  const canAdd = access.can('fb_posts', 'add');
  const canDelete = access.can('fb_posts', 'delete');
  const [pages, clients] = await Promise.all([
    query<{ fp_id: number; fp_page_id: string; fp_name: string; fp_created_on: number; client: string | null; posted: number }>(
      `SELECT f.fp_id, f.fp_page_id, f.fp_name, f.fp_created_on, COALESCE(NULLIF(u.u_company_name, ''), u.u_name) AS client,
              (SELECT COUNT(*) FROM js_fb_post p WHERE p.po_page_id = f.fp_id AND p.po_status = 3)::int AS posted
         FROM js_fb_page f LEFT JOIN js_user u ON u.u_id = f.fp_user_id ORDER BY lower(f.fp_name)`),
    query<{ id: number; name: string }>(
      `SELECT u_id AS id, COALESCE(NULLIF(u_company_name, ''), u_name, u_username) || ' (' || u_username || ')' AS name
         FROM js_user WHERE u_dstatus = 0 ORDER BY lower(COALESCE(NULLIF(u_company_name, ''), u_name, u_username)) LIMIT 2000`),
  ]);
  return (
    <>
      <PageTitle title="Facebook Pages" home="/wamaster/dashboard" />
      <div className="mb-3"><Link href="/wamaster/fb_posts" className="text-muted"><i className="ri-arrow-left-line align-middle" /> Facebook Posts</Link></div>
      <div className="row">
        <div className="col-xl-5">
          <div className="card">
            <div className="card-header"><h5 className="card-title mb-0">Connect Pages</h5></div>
            <div className="card-body">
              <p className="small mb-2">Paste either token:</p>
              <ul className="small ps-3 mb-2">
                <li><b>User or System User token</b>: every Page it manages is connected at once (best for an agency).</li>
                <li><b>Page token</b>: only that Page is connected.</li>
              </ul>
              <ol className="small ps-3 mb-3">
                <li><b>Recommended (never expires):</b> Business Settings → Users → <b>System users</b> → add an Admin system user → <b>Assign assets</b> → tick the client Pages (Content / Full control) → <b>Generate new token</b> for your app.</li>
                <li>Or in <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer">Graph API Explorer</a>: choose your app and <b>User Token</b>, then <b>Get Token</b>.</li>
                <li>Either way, tick the permissions <code>pages_show_list</code>, <code>pages_manage_posts</code> and <code>pages_read_engagement</code>, then copy the token and paste it below.</li>
              </ol>
              {canAdd ? <AddPageForm clients={clients} /> : <p className="text-muted mb-0">Connecting a Page needs the Add right.</p>}
            </div>
          </div>
        </div>
        <div className="col-xl-7">
          <div className="card">
            <div className="card-header"><h5 className="card-title mb-0">Connected Pages</h5></div>
            <div className="card-body">
              <div className="table-responsive">
                <table className="table align-middle table-nowrap mb-0">
                  <thead className="table-light"><tr><th>Page</th><th>Client</th><th className="text-end">Posted</th><th>Connected</th><th /></tr></thead>
                  <tbody>
                    {pages.length ? pages.map((p) => (
                      <tr key={p.fp_id}>
                        <td><a href={`https://www.facebook.com/${p.fp_page_id}`} target="_blank" rel="noreferrer" className="fw-semibold">{p.fp_name}</a><div className="small text-muted">{p.fp_page_id}</div></td>
                        <td>{p.client ?? <span className="text-muted">—</span>}</td>
                        <td className="text-end">{p.posted}</td>
                        <td className="small">{phpDate('d M Y', p.fp_created_on)}</td>
                        <td className="text-end">
                          {canDelete && <form action={deletePage.bind(null, p.fp_id)}>
                            <ConfirmButton message={`Remove the Page “${p.fp_name}”? Its uploads and their status are deleted here (posts already on Facebook stay).`} className="btn btn-sm btn-soft-danger"><i className="ri-delete-bin-line" /></ConfirmButton>
                          </form>}
                        </td>
                      </tr>
                    )) : <tr><td colSpan={5} className="text-center text-muted py-4">No Pages connected yet.</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="small text-muted mt-2 mb-0">To refresh expired tokens, paste a new token: Pages already connected are updated, not duplicated.</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
