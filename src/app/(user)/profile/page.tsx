import type { Metadata } from 'next';
import { PageTitle } from '@/components/PageTitle';
import { PasswordForm } from '@/components/PasswordForm';
import { requireUser } from '@/lib/auth';
import { changePassword } from './actions';
import { ProfileForm } from './ProfileForm';

export const metadata: Metadata = { title: 'Profile' };

/** Account details, email / mobile and password (User\ProfileController::edit). */
export default async function ProfilePage() {
  const user = await requireUser();
  return (
    <>
      <PageTitle title="Profile" home="/dashboard" />
      <div className="row">
        <div className="col-lg-6">
          <div className="card">
            <div className="card-header"><h5 className="card-title mb-0">Account</h5></div>
            <div className="card-body">
              <dl className="row small">
                <dt className="col-sm-4">Name</dt><dd className="col-sm-8">{user.u_name}</dd>
                <dt className="col-sm-4">Company</dt><dd className="col-sm-8">{user.u_company_name}</dd>
                <dt className="col-sm-4">Username</dt><dd className="col-sm-8">{user.u_username}</dd>
                <dt className="col-sm-4">User Code</dt><dd className="col-sm-8">{user.u_code}</dd>
                <dt className="col-sm-4">API Access Key</dt><dd className="col-sm-8"><code>{user.u_access_code}</code></dd>
              </dl>
              <ProfileForm email={user.u_email_id ?? ''} mobile={user.u_mobile_no ?? ''} />
            </div>
          </div>
        </div>
        <div className="col-lg-6">
          <PasswordForm action={changePassword} />
        </div>
      </div>
    </>
  );
}
