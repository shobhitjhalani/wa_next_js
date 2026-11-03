import { NextResponse } from "next/server";
import { chatContacts } from "@/lib/user/chat";
import { routeUser } from "@/lib/user/http";

export async function GET(req: Request) {
  const auth = await routeUser(req, { mutating: false });
  if ("error" in auth) return auth.error;
  const smb = new URL(req.url).searchParams.get("smb") ?? "";
  return NextResponse.json(await chatContacts(auth.userId, smb.trim()));
}
