import { requireAdmin } from '@/lib/auth';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { PageTitle } from '@/components/PageTitle';
import { changePassword, updateProfile } from './actions';
import { PasswordForm } from '@/components/PasswordForm';

/** Staff profile (Admin\ProfileController::edit + admin/profile.blade.php). */
export default async function AdminProfilePage() {
  const member = await requireAdmin();
  return (
    <>
      <PageTitle title="Profile" home="/wamaster/dashboard" />
      <div className="row">
        <div className="col-lg-6">
          <div className="card">
            <div className="card-header"><h5 className="card-title mb-0">Profile</h5></div>
            <div className="card-body">
              <ActionForm action={updateProfile}>
                <div className="mb-3"><label className="form-label">Username</label><input className="form-control" defaultValue={member.emp_username ?? ''} disabled /></div>
                <div className="mb-3">
                  <label className="form-label" htmlFor="name">Name</label>
                  <input className="form-control" id="name" name="name" defaultValue={member.emp_name ?? ''} required />
                </div>
                <div className="mb-3">
                  <label className="form-label" htmlFor="mobile">Mobile</label>
                  <input className="form-control" id="mobile" name="mobile" defaultValue={member.emp_mobile ?? ''} />
                </div>
                <div className="mb-3">
                  <label className="form-label" htmlFor="email_id">Email</label>
                  <input type="email" className="form-control" id="email_id" name="email_id" defaultValue={member.emp_email_id ?? ''} />
                </div>
                <SubmitButton className="btn btn-success">Update Profile</SubmitButton>
              </ActionForm>
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
