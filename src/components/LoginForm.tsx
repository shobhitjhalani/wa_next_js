"use client";

import { useActionState, useState } from "react";

type Action = (prev: string, form: FormData) => Promise<string>;

export default function LoginForm({ action, siteName }: { action: Action; siteName: string }) {
  const [msg, formAction, pending] = useActionState(action, "");
  const [showPassword, setShowPassword] = useState(false);

  return (
    <>
      <div>
        <h5 className="text-primary">Welcome Back !</h5>
        <p className="text-muted">Sign in to continue to {siteName}.</p>
        {msg && <div className="alert alert-danger">{msg}</div>}
      </div>

      <div className="mt-4">
        <form action={formAction}>
          <div className="mb-3">
            <label htmlFor="username" className="form-label">Username</label>
            <input type="text" className="form-control" name="txtusername" id="username" placeholder="Enter username" />
          </div>

          <div className="mb-3">
            <label className="form-label" htmlFor="password-input">Password</label>
            <div className="position-relative auth-pass-inputgroup mb-3">
              <input
                type={showPassword ? "text" : "password"}
                className="form-control pe-5 password-input"
                name="txtpassword"
                placeholder="Enter password"
                id="password-input"
              />
              <button
                className="btn btn-link position-absolute end-0 top-0 text-decoration-none text-muted password-addon"
                type="button"
                onClick={() => setShowPassword((v) => !v)}
              >
                <i className="ri-eye-fill align-middle"></i>
              </button>
            </div>
          </div>

          <div className="mt-4">
            <button className="btn btn-success w-100" type="submit" disabled={pending}>
              {pending ? "Signing In..." : "Sign In"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
