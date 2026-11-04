import 'server-only';
import { cookies } from 'next/headers';

/**
 * Helpers for Server Actions: flash messages (Laravel ->with('success')),
 * a uniform result shape for <ActionForm>, and FormData readers.
 */

export type FlashType = 'success' | 'error';

/**
 * Show a one-time alert on the next rendered page (read by <PageTitle>).
 * Call before redirect() / revalidatePath() in a Server Action or Route Handler.
 */
export async function flash(type: FlashType, message: string): Promise<void> {
  (await cookies()).set('wa_flash', JSON.stringify({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), type, message }), {
    path: '/',
    maxAge: 60,
    sameSite: 'lax',
    httpOnly: false, // the alert component clears it in the browser once shown
  });
}

/** Returned by Server Actions used with <ActionForm>. */
export interface ActionResult {
  ok?: boolean;
  /** Alert above the form (red) */
  error?: string;
  /** Alert above the form (green) */
  message?: string;
  /** Field name → message, shown by <FieldError name=…> */
  errors?: Record<string, string>;
  /** Anything else the client component needs back */
  data?: unknown;
}

export const fail = (error: string, errors?: Record<string, string>): ActionResult => ({ ok: false, error, errors });
export const ok = (message?: string, data?: unknown): ActionResult => ({ ok: true, message, data });

/** Validation failure with field errors; the alert lists them like Laravel's $errors->all(). */
export function invalid(errors: Record<string, string>): ActionResult {
  return { ok: false, errors, error: Object.values(errors).join('\n') };
}

// ------------------------------------------------------------------ FormData readers

export function fStr(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v.trim() : '';
}

/** Raw (untrimmed) string. */
export function fRaw(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
}

export function fInt(fd: FormData, key: string): number {
  const n = parseInt(fStr(fd, key), 10);
  return Number.isFinite(n) ? n : 0;
}

export function fBool(fd: FormData, key: string): boolean {
  const v = fStr(fd, key);
  return v !== '' && v !== '0' && v !== 'false' && v !== 'off';
}

/** All string values for a key ("groups[]" style multi-selects / checkboxes). */
export function fAll(fd: FormData, key: string): string[] {
  return fd.getAll(key).filter((v): v is string => typeof v === 'string');
}

export function fInts(fd: FormData, key: string): number[] {
  return fAll(fd, key).map((v) => parseInt(v, 10)).filter((n) => Number.isFinite(n));
}

/** A non-empty uploaded file, or null. */
export function fFile(fd: FormData, key: string): File | null {
  const v = fd.get(key);
  return v instanceof File && v.size > 0 ? v : null;
}

export function fFiles(fd: FormData, key: string): File[] {
  return fd.getAll(key).filter((v): v is File => v instanceof File && v.size > 0);
}

/** Lower-case file extension without the dot. */
export function fileExt(file: { name: string }): string {
  const m = /\.([^.]+)$/.exec(file.name);
  return m ? m[1].toLowerCase() : '';
}

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
