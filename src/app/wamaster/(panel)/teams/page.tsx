import Link from 'next/link';
import { requireRight } from '@/lib/admin-access';
import { config } from '@/lib/config';
import { like, query, value } from '@/lib/db';
import { sp } from '@/lib/http';
import { masterOptions } from '@/lib/models';
import { phpDate } from '@/lib/time';
import { SUPER_ADMIN, type EmployeeRow } from '@/lib/types';
import { PageTitle } from '@/components/PageTitle';
import { Pagination, pageParam } from '@/components/Pagination';
import { ConfirmButton } from '@/components/ui';
import { deleteMember } from './actions';

type Params = Record<string, string | string[] | undefined>;

/** Team members (TeamController::index). */
export default async function TeamsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await requireRight('employee');
  const me = access.admin;
  const params = await searchParams;
  const q = sp(params, 'q');
  const page = pageParam(params.page);
  const perPage = config.site.pageSize;

  const where = `emp_dstatus = 0 AND ($1 = '' OR emp_name ILIKE '%' || $1 || '%')`;
  const [members, total, roles] = await Promise.all([
    query<EmployeeRow & { emp_right_id: number; last_in: number | null; last_ip: string | null }>(
      `SELECT emp_id, emp_code, emp_name, emp_username, emp_mobile, emp_email_id, emp_right_id, emp_m_type, emp_status, s.aa_on AS last_in, s.aa_ip AS last_ip
         FROM js_employee
         LEFT JOIN LATERAL (SELECT aa_on, aa_ip FROM js_admin_activity WHERE aa_emp_id = emp_id AND aa_action = 'Signed in' ORDER BY aa_id DESC LIMIT 1) s ON true
        WHERE ${where} ORDER BY emp_name LIMIT $2 OFFSET $3`,
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
          {access.can('employee', 'add') && <Link href="/wamaster/teams/create" className="btn btn-primary"><i className="ri-add-line" /> Add Team Member</Link>}
        </div>
        <div className="card-body">
          <div className="table-responsive">
            <table className="table align-middle table-striped mb-0">
              <thead className="table-light"><tr><th>Code</th><th>Name</th><th>Username</th><th>Mobile</th><th>Email</th><th>Role</th><th>Access</th><th>Status</th>{me.isSuperAdmin && <th>Last sign-in · IP</th>}<th /></tr></thead>
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
                    {me.isSuperAdmin && (
                      <td className="small text-nowrap">
                        {m.last_in ? <>{phpDate('d M Y, h:i A', m.last_in)}<div><Link href={`/wamaster/activity?ip=${encodeURIComponent(m.last_ip ?? '')}`} className="font-monospace">{m.last_ip || '—'}</Link></div></> : <span className="text-muted">—</span>}
                        <div><Link href={`/wamaster/activity?emp=${m.emp_id}`}>Activity log</Link></div>
                      </td>
                    )}
                    <td className="text-nowrap text-end">
                      {access.can('employee', 'edit') && <Link href={`/wamaster/teams/${m.emp_id}/edit`} className="btn btn-sm btn-soft-secondary" aria-label="Edit"><i className="ri-pencil-fill" /></Link>}
                      {m.emp_id !== me.emp_id && access.can('employee', 'delete') && (
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
                  <tr><td colSpan={me.isSuperAdmin ? 10 : 9} className="text-center text-muted py-4">No team members.</td></tr>
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
