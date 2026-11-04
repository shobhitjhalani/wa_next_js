'use client';

import type { ActionResult } from '@/lib/actions';
import { ActionForm, SubmitButton } from './ActionForm';
import { PasswordInput } from './ui';

/** Username / password / remember-me form (partials/login-form.blade.php). */
export function LoginForm({ action, subtitle }: { action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult | void>; subtitle: string }) {
  return (
    <>
      <h5 className="text-primary">Welcome Back!</h5>
      <p className="text-muted">{subtitle}</p>
      <ActionForm action={action} className="mt-4">
        <div className="mb-3">
          <label htmlFor="username" className="form-label">Username</label>
          <input type="text" className="form-control" name="username" id="username" placeholder="Enter username" autoComplete="username" required autoFocus />
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor="password-input">Password</label>
          <PasswordInput className="form-control pe-5" name="password" placeholder="Enter password" id="password-input" autoComplete="current-password" required />
        </div>
        <div className="form-check">
          <input className="form-check-input" type="checkbox" name="remember" value="1" id="remember" />
          <label className="form-check-label" htmlFor="remember">Remember me</label>
        </div>
        <div className="mt-4">
          <SubmitButton className="btn btn-success w-100" pendingText="Signing in…">Sign In</SubmitButton>
        </div>
      </ActionForm>
    </>
  );
}
