'use client';

import { ActionForm, FieldError, SubmitButton } from '@/components/ActionForm';
import { updateProfile } from './actions';

export function ProfileForm({ email, mobile }: { email: string; mobile: string }) {
  return (
    <ActionForm action={updateProfile}>
      <div className="mb-3">
        <label className="form-label" htmlFor="email">Email</label>
        <input type="email" className="form-control" id="email" name="email" defaultValue={email} />
        <FieldError name="email" />
      </div>
      <div className="mb-3">
        <label className="form-label" htmlFor="mobile">Mobile</label>
        <input type="text" className="form-control" id="mobile" name="mobile" defaultValue={mobile} />
        <FieldError name="mobile" />
      </div>
      <SubmitButton className="btn btn-success">Update Profile</SubmitButton>
    </ActionForm>
  );
}
