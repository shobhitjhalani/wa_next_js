import Link from 'next/link';
import { DataTableControls, DataTableHidden, SortTh, queryString } from '@/components/DataTable';
import { assignFilter, requireRight, userModule } from '@/lib/admin-access';
import { sqlDir, tableState } from '@/lib/datatable';
import { like, query, value } from '@/lib/db';
import { sp } from '@/lib/http';
import { masterName } from '@/lib/models';
import { phpDate } from '@/lib/time';
import { USER_TYPE } from '@/lib/types';
import { PageTitle } from '@/components/PageTitle';
import { Pagination } from '@/components/Pagination';
import { ConfirmButton } from '@/components/ui';
import { destroyUser, toggleUserStatus } from './actions';
import { ParentFilter } from './ParentFilter';

type SP = Promise<Record<string, string | string[] | undefined>>;

const PATH = '/wamaster/users';

/** Sortable columns → SQL (whitelist; u_id breaks ties so paging is stable). */
const SORTS = {
  created: 'u.u_created_on',
  code: 'u.u_code',
  name: 'lower(u.u_name)',
  company: 'lower(u.u_company_name)',
  username: 'lower(u.u_username::text)',
  parent: "lower(COALESCE(NULLIF(p.u_company_name, ''), p.u_name))",
  valid: 'u.u_valid_till',
  status: 'u.u_status',
} as const;
const DEFAULTS = { perPage: 25, sort: 'created', dir: 'desc' } as const;

/**
 * Client accounts list (Admin\UserController::index + admin/users/index.blade.php). ut=1 corporate, ut=2 WhatsApp.
 * Server-side table: page size, live search and sorting in the URL; status and parent company filters.
 */
export default async function UsersPage({ searchParams }: { searchParams: SP }) {
  const params = await searchParams;
  const utRaw = sp(params, 'ut');
  const type = utRaw === '' ? USER_TYPE.WHATSAPP : parseInt(utRaw, 10) || 0;
  const access = await requireRight(userModule(type));
  const mod = userModule(type);
  const [canAdd, canEdit, canDelete] = [access.can(mod, 'add'), access.can(mod, 'edit'), access.can(mod, 'delete')];
  const table = tableState(params, { sorts: Object.keys(SORTS) as (keyof typeof SORTS)[], sort: DEFAULTS.sort, dir: DEFAULTS.dir, perPage: DEFAULTS.perPage });
  const statusRaw = sp(params, 'status');
  const status = statusRaw === '' ? null : /^\d+$/.test(statusRaw) ? parseInt(statusRaw, 10) : -1;
  // Parent account: '' = all, 0 = accounts without a parent, else the parent's u_id
  const parentRaw = sp(params, 'parent');
  const parent = /^\d+$/.test(parentRaw) ? parseInt(parentRaw, 10) : null;

  const where = `u.u_dstatus = 0 AND u.u_type = $1
    AND ($2 = '' OR u.u_name ILIKE '%' || $2 || '%' OR u.u_username ILIKE '%' || $2 || '%' OR u.u_code ILIKE '%' || $2 || '%'
         OR u.u_company_name ILIKE '%' || $2 || '%' OR u.u_mobile_no ILIKE '%' || $2 || '%' OR u.u_wa_no ILIKE '%' || $2 || '%')
    AND ($3::int IS NULL OR u.u_status = $3::int)
    AND ($4::int IS NULL OR u.u_assign_to = $4::int)
    AND ($5::int IS NULL OR u.u_parent_id = $5::int)`;
  const assigned = assignFilter(access, type);
  const args = [type, like(table.q), status, assigned, parent];

  const [typeName, total, users, parents] = await Promise.all([
    masterName(type),
    value<number>(`SELECT COUNT(*)::int FROM js_user u WHERE ${where}`, args),
    query<{
      u_id: number; u_code: string | null; u_name: string | null; u_company_name: string | null; u_username: string | null;
      u_mobile_no: string | null; u_wa_no: string | null; u_valid_till: number; u_wa_plan_status: number; u_status: number;
      parent_name: string | null; parent_company: string | null;
    }>(
      `SELECT u.u_id, u.u_code, u.u_name, u.u_company_name, u.u_username, u.u_mobile_no, u.u_wa_no, u.u_valid_till,
              u.u_wa_plan_status, u.u_status, p.u_name AS parent_name, p.u_company_name AS parent_company
         FROM js_user u LEFT JOIN js_user p ON p.u_id = u.u_parent_id AND u.u_parent_id > 0
        WHERE ${where}
        ORDER BY ${SORTS[table.sort]} ${sqlDir(table.dir)} NULLS LAST, u.u_id ${sqlDir(table.dir)}
        LIMIT $6 OFFSET $7`,
      [...args, table.perPage, (table.page - 1) * table.perPage],
    ),
    // Parent accounts the users of this type have (only users this admin may see)
    query<{ id: number; label: string; n: number }>(
      `SELECT u.u_parent_id AS id,
              COALESCE(NULLIF(p.u_company_name, ''), NULLIF(p.u_name, ''), p.u_username::text, 'Account #' || u.u_parent_id) AS label,
              COUNT(*)::int AS n
         FROM js_user u LEFT JOIN js_user p ON p.u_id = u.u_parent_id AND u.u_parent_id > 0
        WHERE u.u_dstatus = 0 AND u.u_type = $1 AND ($2::int IS NULL OR u.u_assign_to = $2::int)
        GROUP BY u.u_parent_id, p.u_company_name, p.u_name, p.u_username
        ORDER BY u.u_parent_id = 0, lower(COALESCE(NULLIF(p.u_company_name, ''), NULLIF(p.u_name, ''), p.u_username::text, ''))`,
      [type, assigned],
    ),
  ]);
  const isWa = type === USER_TYPE.WHATSAPP;
  const th = { path: PATH, params, state: table };
  const filtered = status !== null || parent !== null;

  return (
    <>
      <PageTitle title={typeName || 'Users'} home="/wamaster/dashboard" />
      <div className="card">
        <div className="card-header d-flex flex-wrap gap-2 align-items-center">
          <form method="get" className="d-flex flex-wrap gap-2 me-auto align-items-center">
            <input type="hidden" name="ut" value={type} />
            <DataTableHidden state={table} defaults={DEFAULTS} />
            <select name="status" className="form-select w-auto" aria-label="Status" defaultValue={statusRaw === '1' || statusRaw === '2' ? statusRaw : ''}>
              <option value="">All statuses</option>
              <option value="1">Active</option>
              <option value="2">Inactive</option>
            </select>
            <ParentFilter
              value={parent === null ? '' : String(parent)}
              options={[
                ...parents.map((p) => ({ value: String(p.id), label: `${Number(p.id) === 0 ? 'No parent' : p.label} (${p.n})` })),
                ...(parent !== null && !parents.some((p) => Number(p.id) === parent) ? [{ value: String(parent), label: `Account #${parent}` }] : []),
              ]}
            />
            <button className="btn btn-secondary"><i className="ri-filter-3-line" /> Filter</button>
            {filtered && <Link href={`${PATH}?ut=${type}`} className="btn btn-link px-1">Clear</Link>}
          </form>
          <a href={`/wamaster/users/export?ut=${type}`} className="btn btn-soft-info"><i className="ri-download-2-line" /> Export</a>
          {canAdd && <Link href={`/wamaster/users/create?ut=${type}`} className="btn btn-primary"><i className="ri-add-line" /> Add User</Link>}
        </div>
        <div className="card-body">
          <DataTableControls path={PATH} query={queryString(params)} perPage={table.perPage} q={table.q} total={total ?? 0}
            placeholder="Search name, username, code, company, mobile…" />
          <div className="table-responsive">
            <table className="table align-middle table-nowrap table-striped mb-0">
              <thead className="table-light">
                <tr>
                  <SortTh {...th} column="code">Code</SortTh>
                  <SortTh {...th} column="name">Name</SortTh>
                  <SortTh {...th} column="company">Company</SortTh>
                  <SortTh {...th} column="username">Username</SortTh>
                  <th>Mobile</th>
                  {isWa && <><SortTh {...th} column="parent">Parent</SortTh><th>WA No</th><SortTh {...th} column="valid" first="desc">Valid Till</SortTh></>}
                  <SortTh {...th} column="status">Status</SortTh>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.length ? users.map((u) => (
                  <tr key={u.u_id}>
                    <td>{u.u_code}</td>
                    <td><Link href={`/wamaster/users/${u.u_id}`}>{u.u_name}</Link></td>
                    <td>{u.u_company_name}</td>
                    <td>{u.u_username}</td>
                    <td>{u.u_mobile_no}</td>
                    {isWa && (
                      <>
                        <td>{u.parent_company || u.parent_name}</td>
                        <td>{u.u_wa_no}</td>
                        <td className={Number(u.u_wa_plan_status) === 1 ? '' : 'text-danger'}>{u.u_valid_till ? phpDate('d-m-Y', u.u_valid_till) : '—'}</td>
                      </>
                    )}
                    <td>
                      {canEdit ? (
                        <form action={toggleUserStatus.bind(null, u.u_id)}>
                          <button className={`badge border-0 ${Number(u.u_status) === 1 ? 'bg-success' : 'bg-secondary'}`} title="Toggle status">{Number(u.u_status) === 1 ? 'Active' : 'Inactive'}</button>
                        </form>
                      ) : (
                        <span className={`badge ${Number(u.u_status) === 1 ? 'bg-success' : 'bg-secondary'}`}>{Number(u.u_status) === 1 ? 'Active' : 'Inactive'}</span>
                      )}
                    </td>
                    <td className="text-nowrap">
                      <Link href={`/wamaster/users/${u.u_id}`} className="btn btn-sm btn-soft-primary" title="View" aria-label="View"><i className="ri-eye-line" /></Link>{' '}
                      {canEdit && <><Link href={`/wamaster/users/${u.u_id}/edit`} className="btn btn-sm btn-soft-secondary" title="Edit" aria-label="Edit"><i className="ri-pencil-fill" /></Link>{' '}</>}
                      {canDelete && (
                        <form action={destroyUser.bind(null, u.u_id)} className="d-inline">
                          <ConfirmButton message="Delete this user?" className="btn btn-sm btn-soft-danger" title="Delete" aria-label="Delete"><i className="ri-delete-bin-fill" /></ConfirmButton>
                        </form>
                      )}
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={10} className="text-center text-muted py-4">{table.q || filtered ? 'No users match these filters.' : 'No users found.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination path={PATH} params={params} page={table.page} perPage={table.perPage} total={total ?? 0} always />
        </div>
      </div>
    </>
  );
}
