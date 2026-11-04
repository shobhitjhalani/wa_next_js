import Link from 'next/link';
import { requireAdminCan } from '@/lib/auth';
import { config } from '@/lib/config';
import { query } from '@/lib/db';
import { masterOptions } from '@/lib/models';
import type { EmployeeRow } from '@/lib/types';
import { ActionForm, FieldError, SubmitButton } from '@/components/ActionForm';
import { PageTitle } from '@/components/PageTitle';
import { saveMember } from './actions';

type Member = EmployeeRow & { emp_right_id: number; emp_address: string | null };

/** Add / edit team member with page rights (admin/teams/form.blade.php). */
export async function TeamForm({ member }: { member: Member | null }) {
  const me = await requireAdminCan('employee');
  const [roles, modules, actions, granted] = await Promise.all([
    masterOptions(config.masters.teamRole),
    query<{ mo_name: string | null; mo_code: string | null }>('SELECT mo_name, mo_code FROM js_modules WHERE mo_status = 1 ORDER BY mo_group, mo_name'),
    query<{ ma_id: number; ma_name: string | null }>('SELECT ma_id, ma_name FROM js_m_actions ORDER BY ma_id'),
    member
      ? query<{ er_page_action: string }>('SELECT er_page_action FROM js_employee_rights WHERE er_emp_id = $1 AND er_dstatus = 0', [member.emp_id])
      : Promise.resolve([]),
  ]);
  const has = new Set(granted.map((g) => g.er_page_action));
  const v = (x: unknown) => (x == null ? '' : String(x));
  const cur = member ?? ({ emp_status: 1, emp_m_type: 1 } as Partial<Member>);

  return (
    <>
      <PageTitle title={member ? 'Edit Team Member' : 'Add Team Member'} home="/wamaster/dashboard" />
      <ActionForm action={saveMember.bind(null, member?.emp_id ?? null)}>
        <div className="card">
          <div className="card-body row g-3">
            <div className="col-md-4"><label className="form-label" htmlFor="name">Name *</label><input className="form-control" id="name" name="name" defaultValue={v(cur.emp_name)} required /><FieldError name="name" /></div>
            <div className="col-md-4"><label className="form-label" htmlFor="mobile">Mobile</label><input className="form-control" id="mobile" name="mobile" defaultValue={v(cur.emp_mobile)} /><FieldError name="mobile" /></div>
            <div className="col-md-4"><label className="form-label" htmlFor="email_id">Email</label><input type="email" className="form-control" id="email_id" name="email_id" defaultValue={v(cur.emp_email_id)} /><FieldError name="email_id" /></div>
            <div className="col-md-4"><label className="form-label" htmlFor="username">Username *</label><input className="form-control" id="username" name="username" defaultValue={v(cur.emp_username)} required autoComplete="off" /><FieldError name="username" /></div>
            <div className="col-md-4"><label className="form-label" htmlFor="password">Password {member ? '(leave blank to keep)' : '*'}</label><input type="password" className="form-control" id="password" name="password" autoComplete="new-password" required={!member} /><FieldError name="password" /></div>
            <div className="col-md-4">
              <label className="form-label" htmlFor="right_id">Role</label>
              <select className="form-select" id="right_id" name="right_id" defaultValue={v(cur.emp_right_id)}>
                <option value="">—</option>
                {roles.map((r) => <option key={r.value} value={String(r.value)}>{r.label}</option>)}
              </select>
              <FieldError name="right_id" />
            </div>
            <div className="col-md-4">
              <label className="form-label" htmlFor="m_type">Access Level</label>
              <select className="form-select" id="m_type" name="m_type" defaultValue={v(cur.emp_m_type)}>
                <option value="1">Team Member</option>
                {me.isSuperAdmin && <option value="4">Super Admin</option>}
              </select>
              <FieldError name="m_type" />
            </div>
            <div className="col-md-4">
              <label className="form-label" htmlFor="status">Status</label>
              <select className="form-select" id="status" name="status" defaultValue={v(cur.emp_status)}>
                <option value="1">Active</option>
                <option value="2">Inactive</option>
              </select>
              <FieldError name="status" />
            </div>
            <div className="col-md-4"><label className="form-label" htmlFor="address">Address</label><input className="form-control" id="address" name="address" defaultValue={v(cur.emp_address)} /><FieldError name="address" /></div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h5 className="card-title mb-0">Page Rights</h5>
            <p className="text-muted small mb-0">Super admins have every right. Everyone can see the dashboard and users.</p>
          </div>
          <div className="card-body">
            {!modules.length ? (
              <p className="text-muted mb-0">No modules are configured (js_modules). Add rows such as <code>masters</code>, <code>teams</code>, <code>reports</code> to grant access per page.</p>
            ) : (
              <div className="table-responsive">
                <table className="table table-sm align-middle mb-0">
                  <thead className="table-light"><tr><th>Module</th>{actions.map((a) => <th key={a.ma_id} className="text-center">{a.ma_name}</th>)}</tr></thead>
                  <tbody>
                    {modules.map((mo) => (
                      <tr key={mo.mo_code ?? mo.mo_name}>
                        <td>{mo.mo_name}</td>
                        {actions.map((a) => {
                          const code = `${mo.mo_code}_${a.ma_id}`;
                          return (
                            <td key={a.ma_id} className="text-center">
                              <input type="checkbox" className="form-check-input" name="rights[]" value={code} defaultChecked={has.has(code)} aria-label={`${mo.mo_name} ${a.ma_name}`} />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <SubmitButton className="btn btn-success">Save</SubmitButton>{' '}
        <Link href="/wamaster/teams" className="btn btn-light">Cancel</Link>
      </ActionForm>
    </>
  );
}
