import { NextResponse } from "next/server";
import { fetchIncomingAttachment } from "@/lib/user/attachments";
import { redirectTo, routeUser } from "@/lib/user/http";

// view_attachment.php?id=<message id> — opens the downloaded file.
export async function GET(req: Request) {
  const auth = await routeUser(req, { mutating: false });
  if ("error" in auth) return auth.error;
  let id: bigint;
  try {
    id = BigInt(new URL(req.url).searchParams.get("id") ?? "");
  } catch {
    return new NextResponse("Invalid attachment id", { status: 400 });
  }
  const { url, error } = await fetchIncomingAttachment(auth.userId, id);
  if (!url) return new NextResponse(error ?? "Unable to load attachment", { status: error === "Attachment not found" ? 404 : 502 });
  return redirectTo(url);
}
