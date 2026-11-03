import "server-only";
import { NextResponse } from "next/server";
import { getUserSession } from "@/lib/session";

/**
 * Guard for user-panel route handlers: signed-in user and, for state-changing
 * requests, a same-origin Origin/Referer (server actions get this from Next itself).
 */
export async function routeUser(req: Request, { mutating = true } = {}) {
  const session = await getUserSession();
  if (!session.userId) return { error: NextResponse.redirect(new URL("/", req.url)) } as const;
  if (mutating) {
    const origin = req.headers.get("origin") ?? req.headers.get("referer");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (origin && host && new URL(origin).host !== host) {
      return { error: NextResponse.json({ error: "Cross-site request blocked" }, { status: 403 }) } as const;
    }
  }
  return { userId: session.userId, session } as const;
}

/** Relative redirect (works behind the Nginx proxy without trusting Host). */
export const redirectTo = (path: string) => new NextResponse(null, { status: 303, headers: { Location: path } });
