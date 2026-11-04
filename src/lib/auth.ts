import 'server-only';
import { randomUUID } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { forbidden, redirect } from 'next/navigation';
import { cache } from 'react';
import { jwtVerify, SignJWT } from 'jose';
import { config } from './config';
import { exec, insert, one } from './db';
import { employeeCanAccess } from './models';
import type { EmployeeRow, UserRow } from './types';

/**
 * Two independent sign-ins, like the Laravel "web" and "admin" guards:
 *   wa_user  → js_user     (user panel, "/")
 *   wa_admin → js_employee (admin panel, "/wamaster")
 * Each is a signed, httpOnly JWT cookie holding the account id and its
 * login-log row id. The account row is loaded once per request (cached).
 */

const USER_COOKIE = 'wa_user';
const ADMIN_COOKIE = 'wa_admin';
const REMEMBER_SECONDS = 30 * 86400;

interface SessionClaims {
  sub: string;
  lid: number; // js_user_login_log / js_employee_login_log id
  sid: string; // session id written to the login log
}

function secret(): Uint8Array {
  if (!config.sessionSecret || config.sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must be set to at least 32 characters in .env');
  }
  return new TextEncoder().encode(config.sessionSecret);
}

async function readClaims(name: string): Promise<SessionClaims | null> {
  const token = (await cookies()).get(name)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'], audience: name });
    return payload as unknown as SessionClaims;
  } catch {
    return null;
  }
}

async function writeSession(name: string, accountId: number, lid: number, sid: string, remember: boolean): Promise<void> {
  const maxAge = remember ? REMEMBER_SECONDS : config.sessionHours * 3600;
  const token = await new SignJWT({ lid, sid })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(accountId))
    .setAudience(name)
    .setIssuedAt()
    .setExpirationTime(`${maxAge}s`)
    .sign(secret());
  (await cookies()).set(name, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.appUrl.startsWith('https://'),
    path: '/',
    ...(remember ? { maxAge } : {}),
  });
}

/** Client IP for login logs. */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip') ?? '').trim();
}

// ------------------------------------------------------------------ user panel

/** The signed-in WhatsApp client account, or null. Cached for the request. */
export const getUser = cache(async (): Promise<UserRow | null> => {
  const claims = await readClaims(USER_COOKIE);
  if (!claims) return null;
  return one<UserRow>('SELECT * FROM js_user WHERE u_id = $1 AND u_dstatus = 0', [Number(claims.sub)]);
});

/** Signed-in user or redirect to the login page. */
export async function requireUser(): Promise<UserRow> {
  const user = await getUser();
  if (!user) redirect('/');
  return user;
}

/** AI pages are only available to accounts with u_enable_ai = 1 (403 otherwise). */
export async function requireAiUser(): Promise<UserRow> {
  const user = await requireUser();
  if (Number(user.u_enable_ai) !== 1) forbidden();
  return user;
}

export async function startUserSession(user: Pick<UserRow, 'u_id' | 'u_name'>, remember: boolean): Promise<void> {
  const sid = randomUUID();
  const log = await insert<{ ll_id: number }>('js_user_login_log', {
    ll_sid: user.u_id,
    ll_s_user: user.u_name,
    ll_s_time: Math.floor(Date.now() / 1000),
    ll_session_id: sid,
    ll_ip: await clientIp(),
  }, 'll_id');
  await writeSession(USER_COOKIE, user.u_id, log.ll_id, sid, remember);
}

export async function endUserSession(): Promise<void> {
  const claims = await readClaims(USER_COOKIE);
  if (claims) {
    await exec('UPDATE js_user_login_log SET ll_e_time = $2 WHERE ll_id = $1', [claims.lid, Math.floor(Date.now() / 1000)]);
    await exec('UPDATE js_user SET u_last_active = 0 WHERE u_id = $1', [Number(claims.sub)]);
  }
  (await cookies()).delete(USER_COOKIE);
}

// ------------------------------------------------------------------ admin panel

export type Admin = EmployeeRow & { isSuperAdmin: boolean };

/** The signed-in staff member, or null. Cached for the request. */
export const getAdmin = cache(async (): Promise<Admin | null> => {
  const claims = await readClaims(ADMIN_COOKIE);
  if (!claims) return null;
  const emp = await one<EmployeeRow>('SELECT * FROM js_employee WHERE emp_id = $1 AND emp_dstatus = 0', [Number(claims.sub)]);
  return emp ? { ...emp, isSuperAdmin: Number(emp.emp_m_type) === 4 } : null;
});

/** Signed-in staff member or redirect to the admin login page. */
export async function requireAdmin(): Promise<Admin> {
  const admin = await getAdmin();
  if (!admin) redirect('/wamaster');
  return admin;
}

/** Admin page guard: `requireAdminCan('masters')`, `requireAdminCan('employee')` or 'super' (403 otherwise). */
export async function requireAdminCan(page: string): Promise<Admin> {
  const admin = await requireAdmin();
  const allowed = page === 'super' ? admin.isSuperAdmin : await employeeCanAccess(admin, page);
  if (!allowed) forbidden();
  return admin;
}

export async function startAdminSession(emp: Pick<EmployeeRow, 'emp_id' | 'emp_name'>, remember: boolean): Promise<void> {
  const sid = randomUUID();
  const log = await insert<{ ll_id: number }>('js_employee_login_log', {
    ll_sid: emp.emp_id,
    ll_s_user: emp.emp_name,
    ll_s_time: Math.floor(Date.now() / 1000),
    ll_session_id: sid,
    ll_ip: await clientIp(),
  }, 'll_id');
  await writeSession(ADMIN_COOKIE, emp.emp_id, log.ll_id, sid, remember);
}

export async function endAdminSession(): Promise<void> {
  const claims = await readClaims(ADMIN_COOKIE);
  if (claims) {
    await exec('UPDATE js_employee_login_log SET ll_e_time = $2 WHERE ll_id = $1', [claims.lid, Math.floor(Date.now() / 1000)]);
    await exec('UPDATE js_employee SET emp_is_login = 0 WHERE emp_id = $1', [Number(claims.sub)]);
  }
  (await cookies()).delete(ADMIN_COOKIE);
}
