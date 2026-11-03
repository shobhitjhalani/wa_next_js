// waapi/shopify.php. Reached at /api/shopify/v1/<at>/ and /waapi/shopify.php?at=<at>.
import { legacyRoute } from "@/lib/api/route";
import { handleShopify, isShopifyEvent, shopifySignatureOk } from "@/lib/api/shopify";

export const dynamic = "force-dynamic";

export const { GET, POST, OPTIONS } = legacyRoute(async (req) => {
  const at = req.request.at;
  if (at === undefined || !isShopifyEvent(at)) return { text: "" };
  if (!shopifySignatureOk(req.raw, req.headers.get("x-shopify-hmac-sha256"))) {
    return { json: { status: "401", msg: "Invalid signature" } };
  }
  const logContext = { body: req.raw, header: Object.fromEntries(req.headers), post: req.post };
  return { json: await handleShopify(at, req.raw, logContext) };
});
