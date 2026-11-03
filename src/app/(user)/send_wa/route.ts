import { db } from "@/lib/db";
import { now } from "@/lib/config";
import { redirectTo, routeUser } from "@/lib/user/http";
import { sendClaimedMessages } from "@/lib/wa/sender";

// send_wa.php: resend one message now. p=a -> reports, p=f -> reports_failed, else que.
export async function POST(req: Request) {
  const auth = await routeUser(req);
  if ("error" in auth) return auth.error;
  const form = await req.formData();
  const p = String(form.get("p") ?? "");
  let id: bigint | null = null;
  try {
    id = BigInt(String(form.get("id") ?? ""));
  } catch {
    id = null;
  }
  if (id) {
    const claimed = await db.js_message.updateMany({
      where: { m_id: id, m_source: 2, m_user_id: auth.userId },
      data: { m_delivery_status: "", m_error_codes: "", m_status_response: "", m_status: 6, m_in_process_on: now() },
    });
    if (claimed.count > 0) await sendClaimedMessages({ msgId: id, userId: auth.userId, variant: "meta" });
  }
  return redirectTo(p === "a" ? "/reports" : p === "f" ? "/reports_failed" : "/que");
}
