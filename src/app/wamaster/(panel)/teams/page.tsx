import Link from 'next/link';
import { requireAdminCan } from '@/lib/auth';
import { config } from '@/lib/config';
import { like, query, value } from '@/lib/db';
import { sp } from '@/lib/http';
import { masterOptions } from '@/lib/models';
import { SUPER_ADMIN, type EmployeeRow } from '@/lib/types';
import { PageTitle } from '@/components/PageTitle';
import { Pagination, pageParam } from '@/components/Pagination';
import { ConfirmButton } from '@/components/ui';
import { deleteMember } from './actions';

type Params = Record<string, string | string[] | undefined>;

/** Team members (TeamController::index). */
export default async function TeamsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const me = await requireAdminCan('employee');
  const params = await searchParams;
  const q = sp(params, 'q');
  const page = pageParam(params.page);
  const perPage = config.site.pageSize;

  const where = `emp_dstatus = 0 AND ($1 = '' OR emp_name ILIKE '%' || $1 || '%')`;
  const [members, total, roles] = await Promise.all([
    query<EmployeeRow & { emp_right_id: number }>(
      `SELECT emp_id, emp_code, emp_name, emp_username, emp_mobile, emp_email_id, emp_right_id, emp_m_type, emp_status
         FROM js_employee WHERE ${where} ORDER BY emp_name LIMIT $2 OFFSET $3`,
      [like(q), perPage, (page - 1) * perPage],
    ),
    value<number>(`SELECT COUNT(*)::int FROM js_employee WHERE ${where}`, [like(q)]),
    masterOptions(config.masters.teamRole),
  ]);
  const roleName = new Map(roles.map((r) => [Number(r.value), r.label]));

  return (
    <>
      <PageTitle title="Team Members" home="/wamaster/dashboard" />
      <div className="card">
        <div className="card-header d-flex flex-wrap gap-2 align-items-center">
          <form method="get" className="d-flex gap-2 me-auto">
            <input type="text" className="form-control" name="q" defaultValue={q} placeholder="Search name" aria-label="Search" />
            <button className="btn btn-secondary">Search</button>
          </form>
          <Link href="/wamaster/teams/create" className="btn btn-primary"><i className="ri-add-line" /> Add Team Member</Link>
        </div>
        <div className="card-body">
          <div className="table-responsive">
            <table className="table align-middle table-striped mb-0">
              <thead className="table-light"><tr><th>Code</th><th>Name</th><th>Username</th><th>Mobile</th><th>Email</th><th>Role</th><th>Access</th><th>Status</th><th /></tr></thead>
              <tbody>
                {members.length ? members.map((m) => (
                  <tr key={m.emp_id}>
                    <td>{m.emp_code}</td>
                    <td>{m.emp_name}</td>
                    <td>{m.emp_username}</td>
                    <td>{m.emp_mobile}</td>
                    <td>{m.emp_email_id}</td>
                    <td>{roleName.get(Number(m.emp_right_id)) ?? '—'}</td>
                    <td>{Number(m.emp_m_type) === SUPER_ADMIN ? 'Super Admin' : 'Team Member'}</td>
                    <td><span className={`badge ${Number(m.emp_status) === 1 ? 'bg-success' : 'bg-secondary'}`}>{Number(m.emp_status) === 1 ? 'Active' : 'Inactive'}</span></td>
                    <td className="text-nowrap text-end">
                      <Link href={`/wamaster/teams/${m.emp_id}/edit`} className="btn btn-sm btn-soft-secondary" aria-label="Edit"><i className="ri-pencil-fill" /></Link>
                      {m.emp_id !== me.emp_id && (
                        <>
                          {' '}
                          <form action={deleteMember.bind(null, m.emp_id)} className="d-inline">
                            <ConfirmButton message="Delete this team member?" className="btn btn-sm btn-soft-danger" aria-label="Delete"><i className="ri-delete-bin-fill" /></ConfirmButton>
                          </form>
                        </>
                      )}
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={9} className="text-center text-muted py-4">No team members.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3"><Pagination path="/wamaster/teams" params={params} page={page} perPage={perPage} total={total ?? 0} /></div>
        </div>
      </div>
    </>
  );
}
