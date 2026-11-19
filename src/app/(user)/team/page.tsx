import type { Metadata } from 'next';
import { PageTitle } from '@/components/PageTitle';
import { ConfirmButton } from '@/components/ui';
import { requireUser, type MemberRow } from '@/lib/auth';
import { query } from '@/lib/db';
import { normalizePerms, permSummary } from '@/lib/team';
import { phpDate } from '@/lib/time';
import { MemberModal } from './MemberModal';
import { deleteMember } from './actions';

export const metadata: Metadata = { title: 'My Team' };

/** The account's team members and their permissions (owner only). */
export default async function TeamPage() {
  const user = await requireUser();
  const members = await query<MemberRow & { chats: number; campaigns: number }>(
    `SELECT m.*,
            (SELECT COUNT(*) FROM js_user_contact_list c WHERE c.cl_user_id = m.um_user_id AND c.cl_assigned_member = m.um_id)::int AS chats,
            (SELECT COUNT(*) FROM js_user_campaign uc WHERE uc.uc_user_id = m.um_user_id AND uc.uc_member_id = m.um_id)::int AS campaigns
       FROM js_user_member m WHERE m.um_user_id = $1 ORDER BY m.um_status, lower(m.um_name)`, [user.u_id]);

  return (
    <>
      <PageTitle title="My Team" home="/dashboard" />
      <div className="card">
        <div className="card-header d-flex align-items-center flex-wrap gap-2">
          <div className="me-auto">
            <h5 className="card-title mb-0">My Team</h5>
            <p className="text-muted small mb-0">Give your staff their own login with only the rights they need. They sign in on the normal login page.</p>
          </div>
          <button type="button" className="btn btn-success" data-bs-toggle="modal" data-bs-target="#member-new"><i className="ri-user-add-line" /> Add team member</button>
        </div>
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover align-middle table-nowrap mb-0">
              <thead className="table-light">
                <tr><th>Member</th><th>Username</th><th>Permissions</th><th className="text-end">Chats</th><th className="text-end">Campaigns</th><th>Last sign-in</th><th className="text-end">Actions</th></tr>
              </thead>
              <tbody>
                {members.length ? members.map((m) => {
                  const perms = normalizePerms(m.um_perms);
                  const summary = permSummary(perms);
                  return (
                    <tr key={m.um_id}>
                      <td>
                        <div className="fw-semibold">{m.um_name}</div>
                        <div className="small text-muted">{[m.um_mobile, m.um_email].filter(Boolean).join(' · ') || ' '}</div>
                      </td>
                      <td>
                        <code>{m.um_username}</code>
                        {Number(m.um_status) !== 1 && <span className="badge bg-danger-subtle text-danger ms-2">Disabled</span>}
                      </td>
                      <td className="text-wrap" style={{ maxWidth: 360 }}>
                        {summary.length ? summary.map((s) => <span key={s} className="badge bg-light text-body border me-1 mb-1 fw-normal">{s}</span>) : <span className="text-muted small">No access yet</span>}
                      </td>
                      <td className="text-end">{m.chats}</td>
                      <td className="text-end">{m.campaigns}</td>
                      <td className="small">{m.um_last_login ? phpDate('d M Y, h:i A', m.um_last_login) : <span className="text-muted">Never</span>}</td>
                      <td className="text-end">
                        <div className="d-inline-flex gap-2">
                          <button type="button" className="btn btn-sm btn-soft-primary" data-bs-toggle="modal" data-bs-target={`#member-${m.um_id}`}><i className="ri-pencil-line" /> Edit</button>
                          <form action={deleteMember.bind(null, m.um_id)}>
                            <ConfirmButton message={`Remove ${m.um_name} from the team? They can no longer sign in, and their ${m.chats} chat(s) become unassigned.`} className="btn btn-sm btn-soft-danger">
                              <i className="ri-delete-bin-line" />
                            </ConfirmButton>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr><td colSpan={7} className="text-center text-muted py-5">No team members yet. Add your first one: they get their own login with the rights you choose.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <MemberModal id="member-new" />
      {members.map((m) => (
        <MemberModal key={m.um_id} id={`member-${m.um_id}`} member={{
          um_id: m.um_id, um_name: m.um_name, um_username: m.um_username, um_email: m.um_email, um_mobile: m.um_mobile,
          um_status: Number(m.um_status), perms: normalizePerms(m.um_perms),
        }} />
      ))}
    </>
  );
}
