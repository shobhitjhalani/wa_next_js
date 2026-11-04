'use client';

import { createContext, useActionState, useContext, useEffect, useRef, startTransition } from 'react';
import { useFormStatus } from 'react-dom';
import type { ActionResult } from '@/lib/actions';

/**
 * <form> bound to a Server Action that returns an ActionResult:
 *  - shows result.error / result.message as an alert above the fields,
 *  - <FieldError name="x" /> shows result.errors.x under a field,
 *  - keeps what the user typed when the action fails (no React form reset),
 *  - optional confirm() prompt and reset-on-success.
 * Actions that redirect() on success need no special handling.
 *
 *   <ActionForm action={saveGroup} className="row g-2">
 *     <input name="name" className="form-control" />
 *     <FieldError name="name" />
 *     <SubmitButton className="btn btn-primary">Save</SubmitButton>
 *   </ActionForm>
 */

type Action = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult | void>;

const Ctx = createContext<{ state: ActionResult | null; pending: boolean }>({ state: null, pending: false });

export function useActionForm() {
  return useContext(Ctx);
}

export function ActionForm({
  action,
  children,
  confirm,
  resetOnSuccess = false,
  showAlert = true,
  onResult,
  ...rest
}: {
  action: Action;
  children: React.ReactNode;
  confirm?: string;
  resetOnSuccess?: boolean;
  showAlert?: boolean;
  onResult?: (r: ActionResult) => void;
} & Omit<React.FormHTMLAttributes<HTMLFormElement>, 'action' | 'onSubmit'>) {
  const [state, dispatch, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, fd) => (await action(prev, fd)) ?? null,
    null,
  );
  const ref = useRef<HTMLFormElement>(null);
  const nativeAction: (fd: FormData) => void = action.bind(null, state);

  useEffect(() => {
    if (!state) return;
    if (state.ok && resetOnSuccess) ref.current?.reset();
    onResult?.(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Ctx.Provider value={{ state, pending }}>
      <form
        ref={ref}
        {...rest}
        action={nativeAction}
        onSubmit={(e) => {
          e.preventDefault();
          if (confirm && !window.confirm(confirm)) return;
          const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter ?? undefined);
          startTransition(() => dispatch(fd));
        }}
      >
        {showAlert && <FormAlert />}
        {children}
      </form>
    </Ctx.Provider>
  );
}

/** Alert for the last result (rendered automatically at the top of <ActionForm>). */
export function FormAlert() {
  const { state } = useActionForm();
  if (!state) return null;
  if (state.error) return <div className="alert alert-danger" role="alert" style={{ whiteSpace: 'pre-line' }}>{state.error}</div>;
  if (state.message) return <div className="alert alert-success" role="alert" style={{ whiteSpace: 'pre-line' }}>{state.message}</div>;
  return null;
}

export function FieldError({ name }: { name: string }) {
  const { state } = useActionForm();
  const msg = state?.errors?.[name];
  return msg ? <div className="invalid-feedback d-block">{msg}</div> : null;
}

/** Submit button that disables itself while the action runs. */
export function SubmitButton({ children, pendingText, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { pendingText?: string }) {
  const { pending } = useActionForm();
  const status = useFormStatus();
  const busy = pending || status.pending;
  return (
    <button type="submit" disabled={busy || rest.disabled} {...rest}>
      {busy && pendingText ? pendingText : children}
    </button>
  );
}
