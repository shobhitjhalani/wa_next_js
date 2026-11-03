import { NextResponse } from "next/server";
import { routeUser } from "@/lib/user/http";
import { exportMessages } from "@/lib/user/export";
import { readFilters } from "@/lib/user/messages";

// "Export to Excel" on reports_error / reports_failed (fun_download_messages).
export async function GET(req: Request) {
  const auth = await routeUser(req, { mutating: false });
  if ("error" in auth) return auth.error;
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const type = sp.type === "2" || sp.type === "3" ? sp.type : "1";
  const f = readFilters(sp, type === "3" ? "failed" : type === "2" ? "error" : "reports");
  const { buffer, name } = await exportMessages(auth.userId, type, f);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
