import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { routeUser } from "@/lib/user/http";
import { callMeta, MetaApi } from "@/lib/wa/meta-api";

// user_update.php: Embedded Signup finished on the dashboard. Store the ids, then
// Common::fun_register_wa_no(): register the number (PIN 010125) and subscribe the WABA.
export async function POST(req: Request) {
  const auth = await routeUser(req);
  if ("error" in auth) return auth.error;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const phoneId = String(body.phone_number_id ?? "").slice(0, 255);
  const wabaId = String(body.waba_id ?? "").slice(0, 255);
  const businessId = String(body.business_id ?? "").slice(0, 50);
  if (!phoneId) return NextResponse.json({ error: "phone_number_id missing" }, { status: 400 });

  const user = await db.js_user.update({
    where: { u_id: auth.userId },
    data: { u_wa_phone_id: phoneId, u_wa_b_id: wabaId, u_business_id: businessId },
  });
  const register = await callMeta(MetaApi.Register, user, { messaging_product: "whatsapp", pin: "010125" });
  const subscribe = await callMeta(MetaApi.SubscribeWaba, user, {});
  return NextResponse.json({ ok: 1, register, subscribe });
}
