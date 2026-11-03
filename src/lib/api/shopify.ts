// Shopify order webhooks (waapi/shopify.php): new_order and abandoned_cart each send one
// WhatsApp template to the customer on behalf of the shop's account (user 74 in PHP).
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { istParts, now } from "@/lib/config";
import { MsgStatus, sendClaimedMessages } from "@/lib/wa/sender";
import { appLog } from "@/lib/wa/webhook-store";
import { apiContact, entities, phpTitleDate } from "./legacy";

/** The Shopify store's js_user id (hard-coded 74 in PHP). */
export const shopifyUserId = () => Number(process.env.SHOPIFY_USER_ID ?? 74);

/** Optional: when SHOPIFY_WEBHOOK_SECRET is set, require a valid X-Shopify-Hmac-Sha256. PHP checked nothing. */
export function shopifySignatureOk(raw: string, signature: string | null): boolean {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) return true;
  if (!signature) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(raw, "utf8").digest("base64"));
  const got = Buffer.from(signature);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

type Order = {
  phone?: string;
  name?: string;
  billing_address?: { name?: string };
  order_status_url?: string;
};

const EVENTS = {
  new_order: {
    log: "shopify_new_order",
    template: "order_confirmation",
    params: (o: Order) => `${o.billing_address?.name ?? ""},${(o.name ?? "").replace(/#/g, "")}`,
    buttonUrl: (_o: Order) => undefined as string | undefined,
  },
  abandoned_cart: {
    log: "abandoned_cart",
    template: "abandoned_checkout",
    params: (o: Order) => o.billing_address?.name ?? "",
    buttonUrl: (o: Order) => (o.order_status_url ?? "").replace("https://www.uare.co", ""),
  },
} as const;

export type ShopifyEvent = keyof typeof EVENTS;
export const isShopifyEvent = (at: string): at is ShopifyEvent => at in EVENTS;

/**
 * Returns the PHP response body, or null when the order has no phone
 * (PHP then printed json_encode(null) = "null").
 */
export async function handleShopify(event: ShopifyEvent, raw: string, logContext: unknown, userId = shopifyUserId()) {
  const e = EVENTS[event];
  await appLog(e.log, JSON.stringify(logContext));

  let order: Order = {};
  try {
    order = JSON.parse(raw) ?? {};
  } catch {
    order = {};
  }
  const mobile = (order.phone ?? "").trim().slice(-10);
  if (!mobile) return null;

  const name = order.billing_address?.name ?? "";
  const buttonUrl = e.buttonUrl(order);
  const row = await db.js_message
    .create({
      data: {
        m_msg_type: "template",
        m_title: phpTitleDate(),
        m_msg_template_name: e.template,
        m_msg_template_para: entities(e.params(order)),
        m_contact_id: await apiContact(userId, mobile, name),
        m_mobile_no: entities(mobile),
        m_image: "",
        m_base_file: "",
        m_user_id: userId,
        m_status: MsgStatus.Processing,
        m_sheet_id: "shopify",
        m_source: 2,
        m_created_date: istParts().startOfDay,
        m_created_on: now(),
        m_in_process_on: now(),
        ...(buttonUrl !== undefined ? { m_button_url: entities(buttonUrl) } : {}),
      },
    })
    .catch(() => null);

  if (!row) return { data: { id: "0", status: "Unable to Process" }, msg: "201 : Error", status: "201" };
  await sendClaimedMessages({ msgId: row.m_id, variant: "meta" });
  return { data: { id: "0", status: "Success" }, msg: "Success", status: "200" };
}
