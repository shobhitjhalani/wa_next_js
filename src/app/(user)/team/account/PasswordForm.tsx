'use client';

import { ActionForm, FieldError, SubmitButton } from '@/components/ActionForm';
import { PasswordInput } from '@/components/ui';
import { changeMemberPassword } from '../actions';

export function PasswordForm() {
  return (
    <ActionForm action={changeMemberPassword} resetOnSuccess>
      <div className="mb-3">
        <label className="form-label" htmlFor="current_password">Current password</label>
        <PasswordInput className="form-control" id="current_password" name="current_password" autoComplete="current-password" />
        <FieldError name="current_password" />
      </div>
      <div className="mb-3">
        <label className="form-label" htmlFor="new_password">New password</label>
        <PasswordInput className="form-control" id="new_password" name="new_password" autoComplete="new-password" />
        <FieldError name="new_password" />
      </div>
      <div className="mb-3">
        <label className="form-label" htmlFor="new_password_confirmation">Confirm new password</label>
        <PasswordInput className="form-control" id="new_password_confirmation" name="new_password_confirmation" autoComplete="new-password" />
        <FieldError name="new_password_confirmation" />
      </div>
      <SubmitButton className="btn btn-primary" pendingText="Saving…">Change password</SubmitButton>
    </ActionForm>
  );
}
