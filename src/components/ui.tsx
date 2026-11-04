'use client';

import { useEffect, useRef } from 'react';
import flatpickr from 'flatpickr';

/**
 * Small client widgets that replace the Blade layout's inline jQuery.
 */

/**
 * flatpickr range input (legacy .js-date-range): "d-m-Y" or "d-m-Y to d-m-Y".
 * Use inside a GET filter <form>; the value is submitted under `name`.
 */
export function DateRangeInput({ name = 'dt_search', defaultValue = '', className = 'form-control', placeholder = 'Select date range', mode = 'range', ...rest }: {
  name?: string;
  defaultValue?: string;
  className?: string;
  placeholder?: string;
  mode?: 'range' | 'single';
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'name' | 'defaultValue' | 'className' | 'placeholder'>) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const fp = flatpickr(ref.current, { mode, dateFormat: 'd-m-Y' });
    return () => fp.destroy();
  }, [mode]);
  return <input ref={ref} type="text" name={name} defaultValue={defaultValue} className={className} placeholder={placeholder} autoComplete="off" {...rest} />;
}

/** "Select all" checkbox: toggles every checkbox matching `target` (CSS selector). */
export function SelectAll({ target, className = 'form-check-input', id }: { target: string; className?: string; id?: string }) {
  return (
    <input
      type="checkbox"
      id={id}
      className={className}
      aria-label="Select all"
      onChange={(e) => document.querySelectorAll<HTMLInputElement>(target).forEach((c) => { c.checked = e.target.checked; })}
    />
  );
}

/** Submit button that asks for confirmation first (legacy onclick="return confirm(…)"). */
export function ConfirmButton({ message, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { message: string }) {
  return (
    <button
      type="submit"
      {...rest}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
        rest.onClick?.(e);
      }}
    >
      {children}
    </button>
  );
}

/** Show/hide password toggle used on the login forms. */
export function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="position-relative auth-pass-inputgroup">
      <input ref={ref} type="password" {...props} />
      <button
        className="btn btn-link position-absolute end-0 top-0 text-decoration-none text-muted password-addon"
        type="button"
        aria-label="Show password"
        onClick={() => { if (ref.current) ref.current.type = ref.current.type === 'password' ? 'text' : 'password'; }}
      >
        <i className="ri-eye-fill align-middle" />
      </button>
    </div>
  );
}

/** Bootstrap's JS API (loaded globally from the theme bundle). */
export function bootstrap(): any {
  return (window as any).bootstrap;
}

/** Show / hide a Bootstrap modal by element id. */
export function modal(id: string, action: 'show' | 'hide' = 'show') {
  const el = document.getElementById(id);
  const bs = bootstrap();
  if (el && bs) bs.Modal.getOrCreateInstance(el)[action]();
}
