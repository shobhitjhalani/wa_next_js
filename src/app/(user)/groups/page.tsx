import Link from 'next/link';
import { PageTitle } from '@/components/PageTitle';
import { ConfirmButton } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { like, query } from '@/lib/db';
import { sp } from '@/lib/http';
import { numberFormat } from '@/lib/text';
import { phpDate, timestampToUnix } from '@/lib/time';
import { createGroup, deleteGroup, renameGroup } from './actions';
import { CreateGroupForm, RenameGroupModal } from './GroupForms';

type Params = Promise<Record<string, string | string[] | undefined>>;

/** Contact groups with member / opted-out counts (User\GroupController::index). */
export default async function GroupsPage({ searchParams }: { searchParams: Params }) {
  const user = await requireUser();
  const params = await searchParams;
  const q = sp(params, 'q');

  // One pass over the memberships of the user's groups for both counts
  const groups = await query<{ ug_id: number; up_group_name: string; ug_created_on: string | null; contacts_count: number; opted_out_count: number }>(
    `SELECT g.ug_id, g.up_group_name, g.ug_created_on,
            COUNT(c.cl_id)::int AS contacts_count,
            COUNT(c.cl_id) FILTER (WHERE c.cl_opt_out = 1)::int AS opted_out_count
       FROM js_user_groups g
       LEFT JOIN js_user_groups_contact gc ON gc.group_id = g.ug_id
       LEFT JOIN js_user_contact_list c ON c.cl_id = gc.contact_id
      WHERE g.ug_user_id = $1 AND g.ug_dstatus = 0 AND ($2 = '' OR g.up_group_name ILIKE '%' || $2 || '%')
      GROUP BY g.ug_id
      ORDER BY g.up_group_name`,
    [user.u_id, like(q)],
  );

  return (
    <>
      <PageTitle title="Contact Groups" home="/dashboard" />
      <div className="card">
        <div className="card-header">
          <div className="row g-2 align-items-center">
            <form method="get" className="col-md-4 d-flex gap-2">
              <input type="search" className="form-control" name="q" defaultValue={q} placeholder="Search groups" aria-label="Search groups" />
              <button type="submit" className="btn btn-secondary">Search</button>
            </form>
            <CreateGroupForm action={createGroup} />
          </div>
        </div>
        <div className="card-body">
          <div className="table-responsive">
            <table className="table align-middle table-nowrap mb-0">
              <thead className="table-light">
                <tr><th>Group</th><th className="text-end">Contacts</th><th className="text-end">Opted Out</th><th>Created</th><th /></tr>
              </thead>
              <tbody>
                {groups.length ? groups.map((g) => (
                  <tr key={g.ug_id}>
                    <td><Link href={`/contacts?group=${g.ug_id}`} className="fw-medium">{g.up_group_name}</Link></td>
                    <td className="text-end">{numberFormat(g.contacts_count)}</td>
                    <td className={`text-end ${g.opted_out_count ? 'text-danger' : 'text-muted'}`}>{numberFormat(g.opted_out_count)}</td>
                    <td className="small text-muted">{g.ug_created_on ? phpDate('d M Y', timestampToUnix(g.ug_created_on)) : ''}</td>
                    <td className="text-end">
                      <Link href={`/compose?group=${g.ug_id}`} className={`btn btn-sm btn-success${g.contacts_count ? '' : ' disabled'}`}><i className="ri-megaphone-line" /> Send Campaign</Link>{' '}
                      <Link href={`/contacts/upload?group=${g.ug_id}`} className="btn btn-sm btn-soft-primary" title="Upload contacts into this group"><i className="ri-upload-2-line" /></Link>{' '}
                      <button type="button" className="btn btn-sm btn-soft-secondary" data-bs-toggle="modal" data-bs-target="#rename_modal"
                        data-id={g.ug_id} data-name={g.up_group_name} title="Rename" aria-label={`Rename ${g.up_group_name}`}><i className="ri-pencil-line" /></button>{' '}
                      <form action={deleteGroup.bind(null, g.ug_id)} className="d-inline">
                        <ConfirmButton message={`Delete group “${g.up_group_name}”? Its ${numberFormat(g.contacts_count)} contact(s) stay in Contacts.`}
                          className="btn btn-sm btn-soft-danger" title="Delete" aria-label={`Delete ${g.up_group_name}`}><i className="ri-delete-bin-line" /></ConfirmButton>
                      </form>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={5} className="text-center text-muted py-5">No groups yet. Create one above, or <Link href="/contacts/upload">upload contacts</Link> into a new group.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <RenameGroupModal action={renameGroup} />
    </>
  );
}
