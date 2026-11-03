"use client";

import { useActionState } from "react";

type Action = (prev: string, form: FormData) => Promise<string>;

/** A <form> bound to a server action that returns an error message (shown above the fields). */
export default function ActionForm({ action, children, className }: { action: Action; children: React.ReactNode; className?: string }) {
  const [msg, formAction] = useActionState(action, "");
  return (
    <form action={formAction} className={className}>
      {msg && <div className={`alert ${/success|done/i.test(msg) ? "alert-success" : "alert-danger"}`}>{msg}</div>}
      {children}
    </form>
  );
}
