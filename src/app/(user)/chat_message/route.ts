import { NextResponse } from "next/server";
import { chatMessages } from "@/lib/user/chat";
import { routeUser } from "@/lib/user/http";

export async function GET(req: Request) {
  const auth = await routeUser(req, { mutating: false });
  if ("error" in auth) return auth.error;
  const mb = (new URL(req.url).searchParams.get("mb") ?? "").trim();
  if (!mb) return NextResponse.json({ messages: [], canReply: false });
  return NextResponse.json(await chatMessages(auth.userId, mb));
}
