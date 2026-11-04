'use client';

import type { ActionResult } from '@/lib/actions';
import { ActionForm, SubmitButton } from './ActionForm';

/**
 * "Change Password" card (partials/password-form.blade.php), shared by the
 * user and admin profile pages. The action receives current_password,
 * password and password_confirmation; the form clears itself on success.
 *
 *   <PasswordForm action={changePassword} />
 */
export function PasswordForm({ action }: { action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult | void> }) {
  return (
    <div className="card">
      <div className="card-header"><h5 className="card-title mb-0">Change Password</h5></div>
      <div className="card-body">
        <ActionForm action={action} resetOnSuccess>
          <div className="mb-3">
            <label className="form-label" htmlFor="current_password">Current Password</label>
            <input type="password" className="form-control" id="current_password" name="current_password" autoComplete="current-password" required />
          </div>
          <div className="mb-3">
            <label className="form-label" htmlFor="password">New Password</label>
            <input type="password" className="form-control" id="password" name="password" autoComplete="new-password" minLength={6} required />
          </div>
          <div className="mb-3">
            <label className="form-label" htmlFor="password_confirmation">Confirm New Password</label>
            <input type="password" className="form-control" id="password_confirmation" name="password_confirmation" autoComplete="new-password" required />
          </div>
          <SubmitButton className="btn btn-primary">Change Password</SubmitButton>
        </ActionForm>
      </div>
    </div>
  );
}
