import type { Metadata } from 'next';
import Link from 'next/link';
import { DataTableControls, SortTh, queryString } from '@/components/DataTable';
import { FlashAlert } from '@/components/FlashAlert';
import { Pagination } from '@/components/Pagination';
import { PageTitle } from '@/components/PageTitle';
import { ConfirmButton } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { sqlDir, tableState } from '@/lib/datatable';
import { like, query, value } from '@/lib/db';
import { sp } from '@/lib/http';
import { syncTemplates } from '@/lib/services/templates';
import { decodeEntities, limit } from '@/lib/text';
import { phpDate } from '@/lib/time';
import type { TemplateRow } from '@/lib/types';
import { categoryAllowed, categoryRefusal } from '@/lib/template-categories';
import { COMPOSE_TEMPLATE_COLUMNS, TemplatePreview, type ComposeTemplate } from '../compose/TemplateParts';
import { destroyTemplate } from './actions';
import { TemplateViewButton } from './TemplateViewButton';

export const metadata: Metadata = { title: 'WA Templates' };

type Params = Promise<Record<string, string | string[] | undefined>>;
type Row = ComposeTemplate & Pick<TemplateRow, 'ut_created_on' | 'ut_template_category' | 'ut_language'>;

const truthy = (v: string) => ['1', 'true', 'on', 'yes'].includes(v.toLowerCase());

const PATH = '/templates';
/** Sortable columns → SQL (whitelist; ut_id breaks ties so paging is stable). */
const SORTS = {
  created: 'ut_id', name: 'ut_name', category: 'ut_template_category', type: 'ut_template_type', language: 'ut_language',
} as const;

/** Approved templates (User\TemplateController::index); ?sync=1 re-fetches them from Meta. */
export default async function TemplatesPage({ searchParams }: { searchParams: Params }) {
  const user = await requireUser();
  const params = await searchParams;
  const sync = truthy(sp(params, 'sync'));
  // Table links must not carry ?sync=1 (it would re-sync on every click); ?title= (old search links) is the table search
  const { sync: _sync, title, ...tableParams } = params;
  if (tableParams.q === undefined && sp({ title }, 'title')) tableParams.q = sp({ title }, 'title');
  const table = tableState(tableParams, { sorts: Object.keys(SORTS) as (keyof typeof SORTS)[], sort: 'created', dir: 'desc' });

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

  const where = `ut_user_id = $1 AND ut_status = 1 AND ut_dstatus = 0
    AND ($2 = '' OR ut_name ILIKE '%' || $2 || '%' OR ut_message ILIKE '%' || $2 || '%' OR ut_template_category ILIKE '%' || $2 || '%'
         OR ut_template_type ILIKE '%' || $2 || '%' OR ut_language ILIKE '%' || $2 || '%')`;
  const args = [user.u_id, like(table.q)];
  const offset = (table.page - 1) * table.perPage;
  const [total, templates] = await Promise.all([
    value<number>(`SELECT COUNT(*)::int FROM js_user_templates WHERE ${where}`, args).then((n) => n ?? 0),
    query<Row>(
      `SELECT ${COMPOSE_TEMPLATE_COLUMNS}, ut_created_on, ut_template_category, ut_language
         FROM js_user_templates WHERE ${where}
        ORDER BY ${SORTS[table.sort]} ${sqlDir(table.dir)} NULLS LAST, ut_id ${sqlDir(table.dir)}
        LIMIT ${table.perPage} OFFSET $3`,
      [...args, offset],
    ),
  ]);
  const th = { path: PATH, params: tableParams, state: table };

  const canAddTemplate = Number(ownsWaba) === 2 && !!user.u_business_id;
  const canCreateTemplate = !!user.u_wa_b_id;

  return (
    <>
      <PageTitle title="WA Templates" home="/dashboard" />
      {syncFlash && <FlashAlert key={syncFlash.id} flash={syncFlash} />}
      <div className="card">
        <div className="card-header d-flex flex-wrap gap-2 align-items-center">
          <a href="/templates?sync=1" className="btn btn-soft-primary me-auto"><i className="ri-refresh-line" /> Sync from WhatsApp</a>
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
          <DataTableControls path={PATH} query={queryString(tableParams)} perPage={table.perPage} q={table.q} placeholder="Search name, content, category…" />
          <div className="table-responsive">
            <table className="table align-middle table-nowrap table-striped mb-0">
              <thead className="table-light">
                <tr>
                  <th />
                  <th>#</th>
                  <SortTh {...th} column="created" first="desc">Created</SortTh>
                  <SortTh {...th} column="name">Template Name</SortTh>
                  <th>Content</th>
                  <SortTh {...th} column="category">Category</SortTh>
                  <SortTh {...th} column="type">Type</SortTh>
                  <SortTh {...th} column="language">Language</SortTh>
                  <th />
                </tr>
              </thead>
              <tbody>
                {templates.length ? templates.map((t, i) => {
                  const canSend = categoryAllowed(user.u_template_categories, t.ut_template_category);
                  return (
                  <tr key={t.ut_id}>
                    <td>{canSend
                      ? <Link className="btn btn-success btn-sm" href={`/compose?tm=${t.ut_id}`}>Send Template</Link>
                      : <span className="badge bg-secondary-subtle text-secondary" title={categoryRefusal(user.u_template_categories)}>Category not enabled</span>}</td>
                    <td>{offset + i + 1}</td>
                    <td>{t.ut_created_on ? phpDate('d M y H:i', t.ut_created_on) : ''}</td>
                    <td>{t.ut_name}</td>
                    <td className="msg-content small"><div className="msg-content-box">{limit(decodeEntities(t.ut_message ?? ''), 160)}</div></td>
                    <td>{t.ut_template_category}</td>
                    <td><span className="badge bg-info-subtle text-info">{t.ut_template_type}</span></td>
                    <td>{t.ut_language}</td>
                    <td>
                      <div className="d-flex gap-1">
                        <TemplateViewButton
                          id={t.ut_id} name={t.ut_name ?? ''} category={t.ut_template_category} language={t.ut_language}
                          sendHref={canSend ? `/compose?tm=${t.ut_id}` : null}
                        >
                          <TemplatePreview template={t} />
                        </TemplateViewButton>
                        <form action={destroyTemplate.bind(null, t.ut_id)}>
                          <ConfirmButton message="Remove this template from the list?" className="btn btn-sm btn-soft-danger" title="Delete" aria-label="Delete">
                            <i className="ri-delete-bin-fill" />
                          </ConfirmButton>
                        </form>
                      </div>
                    </td>
                  </tr>
                  );
                }) : (
                  <tr><td colSpan={9} className="text-center text-muted py-4">
                    {table.q ? 'No templates match this search.' : 'No approved templates. Use “Sync from WhatsApp” after creating templates in WhatsApp Manager.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination path={PATH} params={tableParams} page={table.page} perPage={table.perPage} total={total} always />
        </div>
      </div>
    </>
  );
}
