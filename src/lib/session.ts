import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";

// Replaces PHP $_SESSION. Users (js_user) and admins (js_employee, /wamaster)
// keep separate encrypted cookies, as the PHP app kept separate session keys.

export type UserSession = {
  userId?: number; // fuid
  name?: string; // funame
  username?: string;
  email?: string;
  mobile?: string;
  code?: string; // ucode
  type?: number; // utype
  apiUrl?: string;
  accessCode?: string;
  loginLogId?: number; // fslogid
};

export type AdminSession = {
  empId?: number; // u_id
  name?: string; // s_name
  mType?: number; // m_type (4 = super admin)
  loginLogId?: number; // slogid
};

const base = {
  password: process.env.SESSION_SECRET as string,
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 12,
  },
};

export const userSessionOptions: SessionOptions = { ...base, cookieName: "wa_user" };
export const adminSessionOptions: SessionOptions = { ...base, cookieName: "wa_admin" };

export async function getUserSession() {
  return getIronSession<UserSession>(await cookies(), userSessionOptions);
}

export async function getAdminSession() {
  return getIronSession<AdminSession>(await cookies(), adminSessionOptions);
}

export const SUPER_ADMIN_TYPE = 4;
