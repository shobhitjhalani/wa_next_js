import { NextResponse } from "next/server";
import { sendChatReply } from "@/lib/user/chat";
import { routeUser } from "@/lib/user/http";

export async function POST(req: Request) {
  const auth = await routeUser(req);
  if ("error" in auth) return auth.error;
  const body = req.headers.get("content-type")?.includes("json")
    ? await req.json()
    : Object.fromEntries((await req.formData()).entries());
  const mb = String(body.mb ?? "").trim();
  const msg = String(body.msg ?? "");
  if (!mb || !msg.trim()) return NextResponse.json({ error: "Please enter message" }, { status: 400 });
  const id = await sendChatReply(auth.userId, mb, msg);
  return NextResponse.json({ ok: 1, id: String(id) });
}
