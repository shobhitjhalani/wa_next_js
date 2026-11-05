import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { crc32 } from 'node:zlib';
import { PageTitle } from '@/components/PageTitle';
import { Pagination, pageParam } from '@/components/Pagination';
import { requireUser } from '@/lib/auth';
import { config } from '@/lib/config';
import { one, query, value } from '@/lib/db';
import { contactDisplayName, contactInitials } from '@/lib/format';
import { jsonParse, numberFormat } from '@/lib/text';
import { shortTime, timestampToUnix } from '@/lib/time';
import { bulkContacts, storeContact, updateContact } from './actions';
import { BulkForm, ContactModal, ImportSummary, type EditableContact, type ImportSummaryData } from './ContactsClient';
import { filterQuery, filterWhere, readFilter } from './filter';

export const metadata: Metadata = { title: 'Contacts' };

type Params = Promise<Record<string, string | string[] | undefined>>;

const PER_PAGE = 50;

interface ListRow {
  cl_id: number;
  cl_name: string | null;
  cl_mobile_no: string | null;
  cl_opt_out: number;
  cl_last_msg: string | null;
  cl_last_msg_id: number;
  groups: { id: number; name: string }[];
}

/** Contact list with filters, bulk actions and the add / edit modal (User\ContactController::index). */
export default async function ContactsPage({ searchParams }: { searchParams: Params }) {
  const user = await requireUser();
  const params = await searchParams;
  const filter = readFilter(params);
  const page = pageParam(params.page);

  const listParams: unknown[] = [];
  const where = filterWhere(user.u_id, filter, listParams);
  const countParams = [...listParams];
  listParams.push(PER_PAGE, (page - 1) * PER_PAGE);

  const [contacts, total, groups, group] = await Promise.all([
    // Page of contacts first, then their groups for just those rows (no N+1)
    query<ListRow>(
      `SELECT p.*,
              COALESCE((SELECT json_agg(json_build_object('id', g.ug_id, 'name', g.up_group_name) ORDER BY gc.id)
                          FROM js_user_groups_contact gc JOIN js_user_groups g ON g.ug_id = gc.group_id
                         WHERE gc.contact_id = p.cl_id), '[]'::json) AS groups
         FROM (SELECT c.cl_id, c.cl_name, c.cl_mobile_no, c.cl_opt_out, c.cl_last_msg, c.cl_last_msg_id
                 FROM js_user_contact_list c WHERE ${where}
                ORDER BY c.cl_id DESC LIMIT $${listParams.length - 1} OFFSET $${listParams.length}) p
        ORDER BY p.cl_id DESC`,
      listParams,
    ),
    value<number>(`SELECT COUNT(*)::int FROM js_user_contact_list c WHERE ${where}`, countParams),
    query<{ ug_id: number; up_group_name: string }>(
      'SELECT ug_id, up_group_name FROM js_user_groups WHERE ug_user_id = $1 AND ug_dstatus = 0 ORDER BY up_group_name', [user.u_id],
    ),
    filter.group !== ''
      ? one<{ ug_id: number; up_group_name: string }>(
        'SELECT ug_id, up_group_name FROM js_user_groups WHERE ug_id = $1 AND ug_user_id = $2 AND ug_dstatus = 0', [parseInt(filter.group, 10) || 0, user.u_id],
      )
      : null,
  ]);
  const totalCount = total ?? 0;

  const importRaw = (await cookies()).get('wa_import')?.value;
  const imported = importRaw ? jsonParse<ImportSummaryData | null>(importRaw, null) : null;
  const qs = filterQuery(filter);

  return (
    <>
      <PageTitle title={group ? `Group: ${group.up_group_name}` : 'Contacts'} home="/dashboard" />
      {imported && <ImportSummary data={imported} />}

      <div className="card">
        <div className="card-header">
          <form method="get" className="row g-2 align-items-center">
            <div className="col-md-4"><input type="search" className="form-control" name="q" defaultValue={filter.q} placeholder="Search name or number" aria-label="Search contacts" /></div>
            <div className="col-md-3">
              <select className="form-select" name="group" aria-label="Group" defaultValue={String(parseInt(filter.group, 10) || '')}>
                <option value="">All groups</option>
                {groups.map((g) => <option key={g.ug_id} value={g.ug_id}>{g.up_group_name}</option>)}
              </select>
            </div>
            <div className="col-md-2">
              <select className="form-select" name="status" aria-label="Status" defaultValue={filter.status === 'opted_out' || filter.status === 'no_group' ? filter.status : ''}>
                <option value="">Everyone</option>
                <option value="opted_out">Opted out</option>
                <option value="no_group">Not in a group</option>
              </select>
            </div>
            <div className="col-auto"><button type="submit" className="btn btn-secondary">Filter</button></div>
            <div className="col-auto ms-auto d-flex flex-wrap gap-2">
              <a href={`/contacts/export${qs}`} className="btn btn-soft-info"><i className="ri-download-2-line" /> Export</a>
              <Link href="/contacts/upload" className="btn btn-soft-primary"><i className="ri-upload-2-line" /> Upload</Link>
              <button type="button" className="btn btn-success" data-bs-toggle="modal" data-bs-target="#contact_modal" data-mode="add"><i className="ri-user-add-line" /> Add Contact</button>
            </div>
          </form>
        </div>

        <BulkForm action={bulkContacts.bind(null, filter)} total={totalCount} pageCount={contacts.length} groups={groups} currentGroup={group?.ug_id ?? null}>
          <div className="table-responsive">
            <table className="table align-middle table-nowrap mb-0">
              <thead className="table-light">
                <tr>
                  <th style={{ width: '1%' }}><input className="form-check-input" type="checkbox" id="check_page" aria-label="Select all on this page" /></th>
                  <th>Name</th>
                  <th>Mobile</th>
                  <th>Groups</th>
                  <th>Last Message</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {contacts.length ? contacts.map((c) => {
                  const display = contactDisplayName(c);
                  const optedOut = Number(c.cl_opt_out) === 1;
                  const edit: EditableContact = {
                    id: c.cl_id, name: c.cl_name, mobile: c.cl_mobile_no, groups: c.groups.map((g) => g.id), opted_out: optedOut, locked: c.cl_last_msg_id > 0,
                  };
                  return (
                    <tr key={c.cl_id}>
                      <td><input className="form-check-input row-check" type="checkbox" name="ids[]" value={c.cl_id} aria-label={`Select ${display}`} /></td>
                      <td>
                        <span className="d-flex align-items-center gap-2">
                          <span className="conv-avatar" style={{ '--hue': crc32(String(c.cl_mobile_no ?? '')) % 360, flexBasis: '32px', height: '32px', fontSize: '.75rem' } as React.CSSProperties} aria-hidden="true">{contactInitials(c)}</span>
                          <span className="text-truncate" style={{ maxWidth: '220px' }}>{c.cl_name || '—'}</span>
                          {optedOut && <span className="badge bg-danger-subtle text-danger">Opted out</span>}
                        </span>
                      </td>
                      <td>{c.cl_mobile_no}</td>
                      <td className="text-wrap" style={{ maxWidth: '260px' }}>
                        {c.groups.map((g) => (
                          <span key={g.id}><Link href={`/contacts?group=${g.id}`} className="badge bg-primary-subtle text-primary">{g.name}</Link>{' '}</span>
                        ))}
                      </td>
                      <td className="small text-muted">{c.cl_last_msg_id ? shortTime(timestampToUnix(c.cl_last_msg)) : '—'}</td>
                      <td className="text-end">
                        {c.cl_last_msg_id > 0 && (
                          <><Link href={`/chat?mb=${encodeURIComponent(c.cl_mobile_no ?? '')}`} className="btn btn-sm btn-soft-success" title="Open chat" aria-label="Open chat"><i className="ri-chat-3-line" /></Link>{' '}</>
                        )}
                        <button type="button" className="btn btn-sm btn-soft-secondary" title="Edit" aria-label={`Edit ${display}`}
                          data-bs-toggle="modal" data-bs-target="#contact_modal" data-mode="edit" data-contact={JSON.stringify(edit)}>
                          <i className="ri-pencil-line" />
                        </button>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr><td colSpan={6} className="text-center text-muted py-5">No contacts found. <Link href="/contacts/upload">Upload a file</Link> or add a contact.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </BulkForm>
        <div className="card-body"><Pagination path="/contacts" params={params} page={page} perPage={PER_PAGE} total={totalCount} /></div>
      </div>

      <ContactModal groups={groups} currentGroup={group?.ug_id ?? null} countryCode={config.countryCode} store={storeContact} update={updateContact} />
    </>
  );
}
