import { completeCcavenue } from "@/lib/user/payments";
import { redirectTo } from "@/lib/user/http";

// CCAvenue redirect_url / cancel_url (the PHP posted back to success.php / error).
// This is a cross-site POST, so the session cookie may be missing: the payment is
// identified by the encrypted order number instead.
export async function POST(req: Request) {
  const form = await req.formData();
  const { paymentId, ok } = await completeCcavenue(String(form.get("encResp") ?? ""));
  return redirectTo(`/success?pl=${paymentId ?? 0}&st=${ok ? 1 : 3}`);
}
