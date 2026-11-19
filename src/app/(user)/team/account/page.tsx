import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PageTitle } from '@/components/PageTitle';
import { requireAccount } from '@/lib/auth';
import { permSummary } from '@/lib/team';
import { PasswordForm } from './PasswordForm';

export const metadata: Metadata = { title: 'My Account' };

/** A team member's own page: who they are, their rights, change password. (The owner uses /profile.) */
export default async function MemberAccountPage() {
  const { user, member, perms } = await requireAccount();
  if (!member) redirect('/profile');
  const summary = permSummary(perms);
  return (
    <>
      <PageTitle title="My Account" home="/dashboard" />
      <div className="row">
        <div className="col-lg-5">
          <div className="card">
            <div className="card-body">
              <h5 className="mb-1">{member.um_name}</h5>
              <p className="text-muted mb-3">Team member of {user.u_company_name || user.u_name} · username <code>{member.um_username}</code></p>
              <div className="small text-muted mb-1">Your permissions</div>
              {summary.length
                ? summary.map((s) => <span key={s} className="badge bg-light text-body border me-1 mb-1 fw-normal">{s}</span>)
                : <p className="text-muted small mb-0">You have no access yet. Ask your account owner to give you permissions.</p>}
            </div>
          </div>
        </div>
        <div className="col-lg-7">
          <div className="card">
            <div className="card-header"><h5 className="card-title mb-0">Change password</h5></div>
            <div className="card-body"><PasswordForm /></div>
          </div>
        </div>
      </div>
    </>
  );
}
