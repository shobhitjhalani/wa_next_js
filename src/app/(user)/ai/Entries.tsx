import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm, FieldError, SubmitButton } from '@/components/ActionForm';
import { PageTitle } from '@/components/PageTitle';
import { ConfirmButton } from '@/components/ui';
import type { ActionResult } from '@/lib/actions';
import { phpDate, timestampToUnix } from '@/lib/time';

export interface Entry { id: number; title: string | null; keywords: string | null; content: string | null; updated: string | null }

/** `{id?}` segment of /ai/knowledge_base/{id} and /ai/prompts/{id} (numeric only, like whereNumber). */
export function entryId(segments: string[] | undefined): number | null {
  if (!segments?.length) return null;
  if (segments.length > 1 || !/^\d+$/.test(segments[0])) notFound();
  return Number(segments[0]);
}

/** List + add / edit form (resources/views/user/ai/entries.blade.php). */
export function Entries({ title, path, items, editing, showForm, save, remove }: {
  title: string;
  path: string;
  items: Entry[];
  editing: Entry | null;
  showForm: boolean;
  save: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  remove: (id: number) => Promise<void>;
}) {
  return (
    <>
      <PageTitle title={title} home="/dashboard" />
      <div className="row">
        <div className={showForm ? 'col-lg-6' : 'col-12'}>
          <div className="card">
            <div className="card-header d-flex align-items-center">
              <h5 className="card-title mb-0 flex-grow-1">{title}</h5>
              <Link href={`${path}?add=1`} className="btn btn-primary btn-sm">Add New</Link>
            </div>
            <div className="card-body">
              <table className="table align-middle table-striped mb-0">
                <thead className="table-light"><tr><th>Name</th><th>Keywords</th><th>Updated</th><th></th></tr></thead>
                <tbody>
                  {items.length ? items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.title}</td>
                      <td className="small text-muted">{item.keywords}</td>
                      <td className="small">{item.updated ? phpDate('d M y H:i', timestampToUnix(item.updated)) : ''}</td>
                      <td className="text-end text-nowrap">
                        <Link href={`${path}/${item.id}`} className="btn btn-sm btn-soft-secondary" title="Edit" aria-label="Edit"><i className="ri-pencil-fill" /></Link>{' '}
                        <form action={remove.bind(null, item.id)} className="d-inline">
                          <ConfirmButton message="Delete this entry?" className="btn btn-sm btn-soft-danger" title="Delete" aria-label="Delete"><i className="ri-delete-bin-fill" /></ConfirmButton>
                        </form>
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan={4} className="text-center text-muted py-4">Nothing added yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        {showForm && (
          <div className="col-lg-6">
            <div className="card">
              <div className="card-header"><h5 className="card-title mb-0">{editing ? 'Edit' : 'Add'} {title}</h5></div>
              <div className="card-body">
                <ActionForm action={save} key={editing?.id ?? 'new'}>
                  <div className="mb-3">
                    <label className="form-label" htmlFor="title">Title</label>
                    <input className="form-control" id="title" name="title" defaultValue={editing?.title ?? ''} required />
                    <FieldError name="title" />
                  </div>
                  <div className="mb-3">
                    <label className="form-label" htmlFor="keywords">Keywords</label>
                    <input className="form-control" id="keywords" name="keywords" defaultValue={editing?.keywords ?? ''} />
                    <FieldError name="keywords" />
                  </div>
                  <div className="mb-3">
                    <label className="form-label" htmlFor="content">Content</label>
                    <textarea className="form-control" id="content" name="content" rows={12} defaultValue={editing?.content ?? ''} />
                  </div>
                  <SubmitButton className="btn btn-success">Save</SubmitButton>{' '}
                  <Link href={path} className="btn btn-light">Cancel</Link>
                </ActionForm>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
