import type { Metadata } from 'next';
import Link from 'next/link';
import { FlashAlert } from '@/components/FlashAlert';
import { PageTitle } from '@/components/PageTitle';
import { ConfirmButton } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { like, query, value } from '@/lib/db';
import { sp } from '@/lib/http';
import { syncTemplates } from '@/lib/services/templates';
import { decodeEntities, limit } from '@/lib/text';
import { phpDate } from '@/lib/time';
import type { TemplateRow } from '@/lib/types';
import { destroyTemplate } from './actions';

export const metadata: Metadata = { title: 'WA Templates' };

type Params = Promise<Record<string, string | string[] | undefined>>;
type Row = Pick<TemplateRow, 'ut_id' | 'ut_created_on' | 'ut_name' | 'ut_message' | 'ut_template_category' | 'ut_template_type' | 'ut_language'>;

const truthy = (v: string) => ['1', 'true', 'on', 'yes'].includes(v.toLowerCase());

/** Approved templates (User\TemplateController::index); ?sync=1 re-fetches them from Meta. */
export default async function TemplatesPage({ searchParams }: { searchParams: Params }) {
  const user = await requireUser();
  const params = await searchParams;
  const sync = truthy(sp(params, 'sync'));
  const title = sp(params, 'title');

  // The legacy page re-synced from Meta on every visit; do it on demand or when the list is empty
  let syncFlash: { id: string; type: 'success' | 'error'; message: string } | null = null;
  const [hasAny, ownsWaba] = await Promise.all([
    sync ? Promise.resolve(true) : value('SELECT 1 FROM js_user_templates WHERE ut_user_id = $1 LIMIT 1', [user.u_id]),
    value<number>('SELECT u_own_account FROM js_user WHERE u_id = $1', [user.u_parent_id]),
  ]);
  if (sync || !hasAny) {
    const count = await syncTemplates(user);
    if (sync) {
      syncFlash = count === null
        ? { id: 'sync-' + Date.now(), type: 'error', message: 'Unable to fetch templates from WhatsApp. Check the WABA ID and access token.' }
        : { id: 'sync-' + Date.now(), type: 'success', message: `${count} templates synced from WhatsApp.` };
    }
  }

  const templates = await query<Row>(
    `SELECT ut_id, ut_created_on, ut_name, ut_message, ut_template_category, ut_template_type, ut_language
       FROM js_user_templates
      WHERE ut_user_id = $1 AND ut_status = 1 AND ut_dstatus = 0 AND ($2 = '' OR ut_name ILIKE '%' || $2 || '%')
      ORDER BY ut_id DESC`,
    [user.u_id, like(title)],
  );

  const canAddTemplate = Number(ownsWaba) === 2 && !!user.u_business_id;
  const canCreateTemplate = !!user.u_wa_b_id;

  return (
    <>
      <PageTitle title="WA Templates" home="/dashboard" />
      {syncFlash && <FlashAlert key={syncFlash.id} flash={syncFlash} />}
      <div className="card">
        <div className="card-header d-flex flex-wrap gap-2 align-items-center">
          <form method="get" className="d-flex gap-2 me-auto">
            <input type="text" className="form-control" name="title" defaultValue={title} placeholder="Template name" aria-label="Template name" />
            <button type="submit" className="btn btn-secondary">Search</button>
          </form>
          <a href="/templates?sync=1" className="btn btn-soft-primary"><i className="ri-refresh-line" /> Sync from WhatsApp</a>
          {canAddTemplate && (
            <a
              href={`https://business.facebook.com/latest/whatsapp_manager/message_templates?business_id=${encodeURIComponent(user.u_business_id ?? '')}&asset_id=${encodeURIComponent(user.u_wa_b_id ?? '')}`}
              target="_blank"
              rel="noopener"
              className="btn btn-soft-secondary"
            >
              <i className="ri-external-link-line" /> WhatsApp Manager
            </a>
          )}
          {canCreateTemplate ? (
            <>
              <Link href="/templates/create?kind=carousel" className="btn btn-soft-primary"><i className="ri-carousel-view" /> Create Carousel</Link>
              <Link href="/templates/create" className="btn btn-primary"><i className="ri-add-line" /> Create Template</Link>
            </>
          ) : (
            <span className="d-inline-block" tabIndex={0} title="Connect a WhatsApp Business account first">
              <button type="button" className="btn btn-primary" disabled><i className="ri-add-line" /> Create Template</button>
            </span>
          )}
        </div>
        <div className="card-body">
          <div className="table-responsive">
            <table className="table align-middle table-nowrap table-striped mb-0">
              <thead className="table-light">
                <tr>
                  <th />
                  <th>#</th>
                  <th>Created</th>
                  <th>Template Name</th>
                  <th>Content</th>
                  <th>Category</th>
                  <th>Type</th>
                  <th>Language</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {templates.length ? templates.map((t, i) => (
                  <tr key={t.ut_id}>
                    <td><Link className="btn btn-success btn-sm" href={`/compose?tm=${t.ut_id}`}>Send Template</Link></td>
                    <td>{i + 1}</td>
                    <td>{t.ut_created_on ? phpDate('d M y H:i', t.ut_created_on) : ''}</td>
                    <td>{t.ut_name}</td>
                    <td className="msg-content small"><div className="msg-content-box">{limit(decodeEntities(t.ut_message ?? ''), 160)}</div></td>
                    <td>{t.ut_template_category}</td>
                    <td><span className="badge bg-info-subtle text-info">{t.ut_template_type}</span></td>
                    <td>{t.ut_language}</td>
                    <td>
                      <form action={destroyTemplate.bind(null, t.ut_id)}>
                        <ConfirmButton message="Remove this template from the list?" className="btn btn-sm btn-soft-danger" title="Delete" aria-label="Delete">
                          <i className="ri-delete-bin-fill" />
                        </ConfirmButton>
                      </form>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={9} className="text-center text-muted py-4">No approved templates. Use “Sync from WhatsApp” after creating templates in WhatsApp Manager.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
