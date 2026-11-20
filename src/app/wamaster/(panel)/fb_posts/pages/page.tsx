import type { Metadata } from 'next';
import Link from 'next/link';
import { PageTitle } from '@/components/PageTitle';
import { ConfirmButton } from '@/components/ui';
import { requireRight } from '@/lib/admin-access';
import { query } from '@/lib/db';
import { NEEDED_PERMISSIONS, PAGE_TASKS } from '@/lib/services/fb-posts';
import { phpDate } from '@/lib/time';
import { deletePage, deleteToken, refreshPagesAction } from '../actions';
import { AddPageForm, PendingButton } from '../Forms';

export const metadata: Metadata = { title: 'Facebook Pages' };

interface PageRow {
  fp_id: number; fp_page_id: string; fp_name: string; fp_created_on: number; fp_tasks: string; fp_status: number; fp_error: string;
  fp_checked_on: number; client: string | null; via: string | null; posted: number;
}
interface TokenRow { ft_id: number; ft_name: string; ft_kind: string; ft_permissions: string; ft_pages: number; ft_status: number; ft_error: string; ft_checked_on: number }

/** Client Facebook Pages the admin can bulk-post to: connect with a token, refresh, see each Page's rights. */
export default async function FbPagesPage() {
  const access = await requireRight('fb_posts');
  const canAdd = access.can('fb_posts', 'add');
  const canDelete = access.can('fb_posts', 'delete');
  const [pages, tokens, clients] = await Promise.all([
    query<PageRow>(
      `SELECT f.fp_id, f.fp_page_id, f.fp_name, f.fp_created_on, f.fp_tasks, f.fp_status, f.fp_error, f.fp_checked_on,
              NULLIF(COALESCE(NULLIF(u.u_company_name, ''), u.u_name), '') AS client, t.ft_name AS via,
              (SELECT COUNT(*) FROM js_fb_post p WHERE p.po_page_id = f.fp_id AND p.po_status = 3)::int AS posted
         FROM js_fb_page f LEFT JOIN js_user u ON u.u_id = f.fp_user_id LEFT JOIN js_fb_token t ON t.ft_id = f.fp_token_id
        ORDER BY f.fp_status DESC, lower(f.fp_name)`),
    query<TokenRow>('SELECT ft_id, ft_name, ft_kind, ft_permissions, ft_pages, ft_status, ft_error, ft_checked_on FROM js_fb_token ORDER BY lower(ft_name)'),
    query<{ id: number; name: string }>(
      `SELECT u_id AS id, COALESCE(NULLIF(u_company_name, ''), u_name, u_username) || ' (' || u_username || ')' AS name
         FROM js_user WHERE u_dstatus = 0 ORDER BY lower(COALESCE(NULLIF(u_company_name, ''), u_name, u_username)) LIMIT 2000`),
  ]);
  const problems = pages.filter((p) => p.fp_status === 2).length;
  const lastCheck = Math.max(0, ...pages.map((p) => p.fp_checked_on));

  return (
    <>
      <PageTitle title="Facebook Pages" home="/wamaster/dashboard" />
      <div className="mb-3"><Link href="/wamaster/fb_posts" className="text-muted"><i className="ri-arrow-left-line align-middle" /> Facebook Posts</Link></div>
      <div className="row">
        <div className="col-xl-4">
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
                <li>Either way, tick the permissions {NEEDED_PERMISSIONS.map((p, i) => <span key={p}>{i > 0 && ', '}<code>{p}</code></span>)} and <code>business_management</code> (finds the client Pages shared with your Business), then copy the token and paste it below.</li>
                <li>When Facebook asks <b>which Pages</b> to allow, choose <b>all</b> of them: the token only covers the Pages ticked there.</li>
              </ol>
              {canAdd ? <AddPageForm clients={clients} /> : <p className="text-muted mb-0">Connecting Pages needs the Add right.</p>}
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h5 className="card-title mb-0">Saved tokens <span className="text-muted fw-normal small">({tokens.length})</span></h5></div>
            <div className="card-body">
              {tokens.length ? (
                <ul className="list-unstyled mb-0">
                  {tokens.map((t) => {
                    const granted = new Set(t.ft_permissions.split(',').filter(Boolean));
                    return (
                      <li key={t.ft_id} className="border-bottom pb-2 mb-2">
                        <div className="d-flex align-items-start gap-2">
                          <div className="me-auto">
                            <div className="fw-semibold">{t.ft_name} <span className="badge bg-light text-body border fw-normal">{t.ft_kind === 'page' ? 'Page token' : 'User token'}</span></div>
                            <div className="small text-muted">
                              {t.ft_status === 2 ? <span className="text-danger">{t.ft_error}</span> : `${t.ft_pages} Page(s)`} · checked {phpDate('d M, h:i A', t.ft_checked_on)}
                            </div>
                          </div>
                          {canDelete && (
                            <form action={deleteToken.bind(null, t.ft_id)}>
                              <ConfirmButton message={`Remove the token of “${t.ft_name}”? Its Pages stay connected, but Refresh no longer uses it to find new Pages.`} className="btn btn-sm btn-soft-danger" title="Remove token"><i className="ri-delete-bin-line" /></ConfirmButton>
                            </form>
                          )}
                        </div>
                        {t.ft_kind === 'user' && (
                          <div className="d-flex flex-wrap gap-1 mt-1">
                            {[...NEEDED_PERMISSIONS, 'business_management'].map((p) => (
                              <span key={p} className={`badge ${granted.has(p) ? 'bg-success-subtle text-success' : 'bg-danger-subtle text-danger'}`} title={granted.has(p) ? 'Granted' : 'Missing'}>
                                <i className={granted.has(p) ? 'ri-check-line' : 'ri-close-line'} /> {p}
                              </span>
                            ))}
                            {[...granted].filter((p) => !NEEDED_PERMISSIONS.includes(p) && p !== 'business_management').length > 0 && (
                              <span className="badge bg-light text-muted border fw-normal" title={[...granted].filter((p) => !NEEDED_PERMISSIONS.includes(p)).join(', ')}>
                                +{[...granted].filter((p) => !NEEDED_PERMISSIONS.includes(p) && p !== 'business_management').length} more
                              </span>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="small text-muted mb-0">None yet. A token pasted above is kept here, so <b>Refresh Pages</b> can find new Pages with it later.</p>}
            </div>
          </div>
        </div>

        <div className="col-xl-8">
          <div className="card">
            <div className="card-header d-flex flex-wrap align-items-center gap-2">
              <div className="me-auto">
                <h5 className="card-title mb-0">Connected Pages <span className="text-muted fw-normal small">({pages.length}{problems ? `, ${problems} with problems` : ''})</span></h5>
                {lastCheck > 0 && <div className="small text-muted">Last checked {phpDate('d M Y, h:i A', lastCheck)}</div>}
              </div>
              {canAdd && pages.length + tokens.length > 0 && (
                <form action={refreshPagesAction}>
                  <PendingButton className="btn btn-sm btn-primary" pendingText="Checking with Facebook…"><i className="ri-refresh-line" /> Refresh Pages</PendingButton>
                </form>
              )}
            </div>
            <div className="card-body">
              <div className="table-responsive">
                <table className="table align-middle mb-0">
                  <thead className="table-light"><tr><th>Page</th><th>Permissions</th><th>Status</th><th>Client</th><th className="text-end">Posted</th><th /></tr></thead>
                  <tbody>
                    {pages.length ? pages.map((p) => {
                      const tasks = p.fp_tasks.split(',').filter(Boolean);
                      return (
                        <tr key={p.fp_id}>
                          <td>
                            <a href={`https://www.facebook.com/${p.fp_page_id}`} target="_blank" rel="noreferrer" className="fw-semibold">{p.fp_name}</a>
                            <div className="small text-muted">{p.fp_page_id}{p.via && <> · via {p.via}</>}</div>
                          </td>
                          <td style={{ maxWidth: 260 }}>
                            {tasks.length ? (
                              <div className="d-flex flex-wrap gap-1">
                                {tasks.map((t) => <span key={t} className={`badge ${PAGE_TASKS[t]?.badge ?? 'bg-light text-body border'}`}>{PAGE_TASKS[t]?.label ?? t.toLowerCase()}</span>)}
                              </div>
                            ) : <span className="small text-muted">{p.via ? 'Not reported by Facebook' : 'Unknown (connected with a Page token)'}</span>}
                            {tasks.length > 0 && !tasks.includes('CREATE_CONTENT') && <div className="small text-danger mt-1">Cannot post: needs Create content</div>}
                          </td>
                          <td className="small" style={{ maxWidth: 240 }}>
                            {p.fp_status === 2
                              ? <><span className="badge bg-danger-subtle text-danger">Problem</span><div className="text-danger mt-1">{p.fp_error}</div></>
                              : <span className="badge bg-success-subtle text-success">Working</span>}
                            {p.fp_checked_on > 0 && <div className="text-muted mt-1">{phpDate('d M, h:i A', p.fp_checked_on)}</div>}
                          </td>
                          <td className="small">{p.client ?? <span className="text-muted">—</span>}</td>
                          <td className="text-end">{p.posted}</td>
                          <td className="text-end">
                            {canDelete && <form action={deletePage.bind(null, p.fp_id)}>
                              <ConfirmButton message={`Remove the Page “${p.fp_name}”? Its uploads and their status are deleted here (posts already on Facebook stay).`} className="btn btn-sm btn-soft-danger"><i className="ri-delete-bin-line" /></ConfirmButton>
                            </form>}
                          </td>
                        </tr>
                      );
                    }) : <tr><td colSpan={6} className="text-center text-muted py-4">No Pages connected yet.</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="small text-muted mt-2 mb-0">
                <b>Refresh Pages</b> asks Facebook again with the saved tokens: new Pages are added, names and permissions updated, and Pages whose token stopped working are marked.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
