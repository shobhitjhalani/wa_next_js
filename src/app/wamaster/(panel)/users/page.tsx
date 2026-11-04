import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { config } from '@/lib/config';
import { like, query, value } from '@/lib/db';
import { sp } from '@/lib/http';
import { masterName } from '@/lib/models';
import { phpDate } from '@/lib/time';
import { USER_TYPE } from '@/lib/types';
import { PageTitle } from '@/components/PageTitle';
import { Pagination, pageParam } from '@/components/Pagination';
import { ConfirmButton } from '@/components/ui';
import { destroyUser, toggleUserStatus } from './actions';

type SP = Promise<Record<string, string | string[] | undefined>>;

/** Client accounts list (Admin\UserController::index + admin/users/index.blade.php). ut=1 corporate, ut=2 WhatsApp. */
export default async function UsersPage({ searchParams }: { searchParams: SP }) {
  await requireAdmin();
  const params = await searchParams;
  const utRaw = sp(params, 'ut');
  const type = utRaw === '' ? USER_TYPE.WHATSAPP : parseInt(utRaw, 10) || 0;
  const q = sp(params, 'q');
  const statusRaw = sp(params, 'status');
  const status = statusRaw === '' ? null : /^\d+$/.test(statusRaw) ? parseInt(statusRaw, 10) : -1;
  const page = pageParam(params.page);
  const perPage = config.site.pageSize;

  const where = `u.u_dstatus = 0 AND u.u_type = $1
    AND ($2 = '' OR u.u_name ILIKE '%' || $2 || '%' OR u.u_username ILIKE '%' || $2 || '%'
         OR u.u_company_name ILIKE '%' || $2 || '%' OR u.u_mobile_no ILIKE '%' || $2 || '%')
    AND ($3::int IS NULL OR u.u_status = $3::int)`;
  const args = [type, like(q), status];

  const [typeName, total, users] = await Promise.all([
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
        ORDER BY u.u_created_on DESC, u.u_id DESC
        LIMIT $4 OFFSET $5`,
      [...args, perPage, (page - 1) * perPage],
    ),
  ]);
  const isWa = type === USER_TYPE.WHATSAPP;

  return (
    <>
      <PageTitle title={typeName || 'Users'} home="/wamaster/dashboard" />
      <div className="card">
        <div className="card-header d-flex flex-wrap gap-2 align-items-center">
          <form method="get" className="d-flex gap-2 me-auto">
            <input type="hidden" name="ut" value={type} />
            <input type="text" className="form-control" name="q" defaultValue={q} placeholder="Name, username, company, mobile" aria-label="Search" />
            <select name="status" className="form-select w-auto" aria-label="Status" defaultValue={statusRaw === '1' || statusRaw === '2' ? statusRaw : ''}>
              <option value="">All</option>
              <option value="1">Active</option>
              <option value="2">Inactive</option>
            </select>
            <button className="btn btn-secondary">Search</button>
          </form>
          <a href={`/wamaster/users/export?ut=${type}`} className="btn btn-soft-info"><i className="ri-download-2-line" /> Export</a>
          <Link href={`/wamaster/users/create?ut=${type}`} className="btn btn-primary"><i className="ri-add-line" /> Add User</Link>
        </div>
        <div className="card-body">
          <div className="table-responsive">
            <table className="table align-middle table-nowrap table-striped mb-0">
              <thead className="table-light">
                <tr>
                  <th>Code</th><th>Name</th><th>Company</th><th>Username</th><th>Mobile</th>
                  {isWa && <><th>Parent</th><th>WA No</th><th>Valid Till</th></>}
                  <th>Status</th><th />
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
                      <form action={toggleUserStatus.bind(null, u.u_id)}>
                        <button className={`badge border-0 ${Number(u.u_status) === 1 ? 'bg-success' : 'bg-secondary'}`} title="Toggle status">{Number(u.u_status) === 1 ? 'Active' : 'Inactive'}</button>
                      </form>
                    </td>
                    <td className="text-nowrap">
                      <Link href={`/wamaster/users/${u.u_id}`} className="btn btn-sm btn-soft-primary" title="View" aria-label="View"><i className="ri-eye-line" /></Link>{' '}
                      <Link href={`/wamaster/users/${u.u_id}/edit`} className="btn btn-sm btn-soft-secondary" title="Edit" aria-label="Edit"><i className="ri-pencil-fill" /></Link>{' '}
                      <form action={destroyUser.bind(null, u.u_id)} className="d-inline">
                        <ConfirmButton message="Delete this user?" className="btn btn-sm btn-soft-danger" title="Delete" aria-label="Delete"><i className="ri-delete-bin-fill" /></ConfirmButton>
                      </form>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={10} className="text-center text-muted py-4">No users found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3"><Pagination path="/wamaster/users" params={params} page={page} perPage={perPage} total={total ?? 0} /></div>
        </div>
      </div>
    </>
  );
}
