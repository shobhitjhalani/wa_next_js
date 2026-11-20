import type { Metadata } from 'next';
import Link from 'next/link';
import { DataTableControls, queryString } from '@/components/DataTable';
import { PageTitle } from '@/components/PageTitle';
import { Pagination } from '@/components/Pagination';
import { ConfirmButton } from '@/components/ui';
import { requireRight } from '@/lib/admin-access';
import { config, url } from '@/lib/config';
import { like, query, value } from '@/lib/db';
import { tableHref, tableState } from '@/lib/datatable';
import { sp } from '@/lib/http';
import { numberFormat } from '@/lib/text';
import { phpDate } from '@/lib/time';
import { CopyButton } from '../../../(user)/api_docs/CopyButton';
import { deleteMedia } from './actions';
import { fileIcon, LIBRARY_TYPES, sizeLabel } from './library';
import { UploadForm } from './UploadForm';

export const metadata: Metadata = { title: 'Media Library' };

const PATH = '/wamaster/media';

interface Row { mf_id: number; mf_folder: string; mf_name: string; mf_path: string; mf_size: number; mf_created_on: number; emp: string | null }

/** Upload documents / images by folder and name and get a public URL (super admin). */
export default async function MediaLibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireRight('media_library');
  const canAdd = access.can('media_library', 'add');
  const canDelete = access.can('media_library', 'delete');
  const params = await searchParams;
  const table = tableState(params, { sorts: ['created'] as const, sort: 'created', dir: 'desc' });
  const folder = sp(params, 'folder');
  const args: unknown[] = [folder, table.q ? `%${like(table.q)}%` : ''];
  const where = `($1 = '' OR f.mf_folder = $1) AND ($2 = '' OR f.mf_name ILIKE $2 OR f.mf_path ILIKE $2)`;
  const [rows, total, folders] = await Promise.all([
    query<Row>(
      `SELECT f.*, e.emp_name AS emp FROM js_media_file f LEFT JOIN js_employee e ON e.emp_id = f.mf_emp_id
        WHERE ${where} ORDER BY f.mf_id DESC LIMIT ${table.perPage} OFFSET ${(table.page - 1) * table.perPage}`, args),
    value<number>(`SELECT COUNT(*)::int FROM js_media_file f WHERE ${where}`, args),
    query<{ mf_folder: string; n: number; bytes: number }>('SELECT mf_folder, COUNT(*)::int AS n, SUM(mf_size)::bigint AS bytes FROM js_media_file GROUP BY mf_folder ORDER BY mf_folder'),
  ]);
  const tableParams = { ...params };

  return (
    <>
      <PageTitle title="Media Library" home="/wamaster/dashboard" />
      {canAdd && (
        <div className="card">
          <div className="card-header"><h5 className="card-title mb-0"><i className="ri-upload-cloud-2-line me-1" />Upload a document or image</h5></div>
          <div className="card-body"><UploadForm folders={folders.map((f) => f.mf_folder)} /></div>
        </div>
      )}
      <div className="card">
        <div className="card-header d-flex flex-wrap align-items-center gap-2">
          <h5 className="card-title mb-0 me-auto">Files</h5>
          <div className="d-flex flex-wrap gap-1">
            <Link href={tableHref(PATH, {}, {})} className={`btn btn-sm ${folder ? 'btn-light' : 'btn-primary'}`}>All folders</Link>
            {folders.map((f) => (
              <Link key={f.mf_folder} href={tableHref(PATH, {}, { folder: f.mf_folder })} className={`btn btn-sm ${folder === f.mf_folder ? 'btn-primary' : 'btn-light'}`}>
                <i className="ri-folder-3-line" /> {f.mf_folder} <span className="opacity-75">({f.n})</span>
              </Link>
            ))}
          </div>
        </div>
        <div className="card-body">
          <DataTableControls path={PATH} query={queryString(tableParams)} perPage={table.perPage} q={table.q} total={total ?? 0} placeholder="Search name or file…" />
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead className="table-light">
                <tr><th style={{ width: 64 }} /><th>Name</th><th>Folder</th><th>Size</th><th>Public URL</th><th>Uploaded</th><th className="text-end">Actions</th></tr>
              </thead>
              <tbody>
                {rows.length ? rows.map((f) => {
                  const ext = f.mf_path.split('.').pop()?.toLowerCase() ?? '';
                  const link = url(`${config.mediaUrl}/${f.mf_path}`);
                  return (
                    <tr key={f.mf_id}>
                      <td>
                        {LIBRARY_TYPES[ext]?.kind === 'image'
                          ? <a href={link} target="_blank" rel="noreferrer"><img src={`${config.mediaUrl}/${f.mf_path}`} alt="" width={48} height={48} className="rounded border" style={{ objectFit: 'cover' }} /></a>
                          : <span className="rounded border bg-light" style={{ width: 48, height: 48, display: 'inline-grid', placeItems: 'center' }}><i className={`${fileIcon(ext)} fs-3`} /></span>}
                      </td>
                      <td><div className="fw-semibold">{f.mf_name}</div><div className="small text-muted">{ext.toUpperCase()}</div></td>
                      <td><Link href={tableHref(PATH, {}, { folder: f.mf_folder })} className="badge bg-light text-body border fw-normal"><i className="ri-folder-3-line" /> {f.mf_folder}</Link></td>
                      <td className="small text-nowrap">{sizeLabel(Number(f.mf_size))}</td>
                      <td style={{ maxWidth: 360 }}>
                        <div className="input-group input-group-sm">
                          <input className="form-control font-monospace" readOnly value={link} aria-label={`URL of ${f.mf_name}`} />
                          <CopyButton text={link} className="btn btn-soft-primary" />
                        </div>
                      </td>
                      <td className="small text-nowrap">{phpDate('d M Y, h:i A', f.mf_created_on)}{f.emp && <div className="text-muted">{f.emp}</div>}</td>
                      <td className="text-end text-nowrap">
                        <a href={link} target="_blank" rel="noreferrer" className="btn btn-sm btn-soft-secondary me-1" title="Open"><i className="ri-external-link-line" /></a>
                        {canDelete && <form action={deleteMedia.bind(null, f.mf_id)} className="d-inline">
                          <ConfirmButton message={`Delete “${f.mf_name}”? Its public URL stops working everywhere it was shared.`} className="btn btn-sm btn-soft-danger" title="Delete"><i className="ri-delete-bin-line" /></ConfirmButton>
                        </form>}
                      </td>
                    </tr>
                  );
                }) : (
                  <tr><td colSpan={7} className="text-center text-muted py-5">{table.q || folder ? 'No files match.' : 'No files yet. Upload the first one above.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination path={PATH} params={tableParams} page={table.page} perPage={table.perPage} total={total ?? 0} always />
          <p className="small text-muted mt-2 mb-0">{numberFormat(folders.reduce((n, f) => n + f.n, 0))} files · {sizeLabel(folders.reduce((n, f) => n + Number(f.bytes), 0))} in total</p>
        </div>
      </div>
    </>
  );
}
