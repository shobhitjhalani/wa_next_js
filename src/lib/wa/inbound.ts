// Processes a Meta WhatsApp webhook POST. Port of waapi/webhook.php and waapi/wawebhook.php
// (variant "wa"): same DB writes and forwards; the two differ only where noted.
import { db } from "@/lib/db";
import { istParts, now } from "@/lib/config";
import {
  ACCESSORY_KEYWORDS,
  DIGITOMATION_INBOUND_URL,
  OWN_APP_URL_USERS,
  psfFormOverride,
} from "./client-rules";
import { sendClaimedMessages } from "./sender";
import {
  appLog,
  contactFor,
  findActiveUser,
  forwardJson,
  incomingLog,
  phpEntities,
  queueStatus,
  saveIncoming,
  type IncomingMessage,
} from "./webhook-store";

export type WebhookVariant = "webhook" | "wa";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

/** What PHP echoed after processing (Meta only needs a 200). */
export type WebhookResult = { status: string; msg: string; data: unknown };

export async function processWebhook(payload: Json, query: Record<string, string>, variant: WebhookVariant): Promise<WebhookResult> {
  const change = payload?.entry?.[0]?.changes?.[0];
  const value = change?.value;
  const phoneId: string | undefined = value?.metadata?.phone_number_id;

  if (change?.field === "calls") await appLog("calls", JSON.stringify(payload), 0);

  const user = phoneId ? await findActiveUser({ u_wa_phone_id: String(phoneId) }) : null;
  if (!user) return { status: "0", msg: "Parameter Missing", data: [] };
  const userId = user.u_id;

  // Raw payload forwarding for app integrations (u_send_app = 1).
  if (user.u_send_app === 1 && user.u_wa_app_url) {
    const target = variant === "wa" || OWN_APP_URL_USERS.includes(userId) ? user.u_wa_app_url : DIGITOMATION_INBOUND_URL;
    await forwardJson(target, payload);
  }

  if (value?.statuses) {
    const s = value.statuses[0] ?? {};
    const failed = s.status === "failed";
    await queueStatus(
      { msg_id: s.id, msg_status: s.status, receipt_no: s.recipient_id, error_reason: failed ? (s.errors ?? []) : [] },
      failed ? (s.errors?.[0]?.title ?? "") : "",
    );
  } else {
    await handleIncoming(user, value, variant);
  }

  return { status: "200", msg: "1", data: { post: {}, request: query } };
}

type User = NonNullable<Awaited<ReturnType<typeof findActiveUser>>>;

async function handleIncoming(user: User, value: Json, variant: WebhookVariant) {
  const userId = user.u_id;
  const message = value?.messages?.[0];
  if (!message) return;

  const messageId: string = message.id ?? "";
  const duplicates = await db.js_message.count({ where: { m_is_incoming: 1, m_message_id: phpEntities(messageId) } });
  if (duplicates > 0) return; // Meta retries webhooks; store each message once.

  const waId: string = value?.contacts?.[0]?.wa_id ?? "";
  const msg: IncomingMessage = {
    message_id: messageId,
    reply_message_id: message.context?.id ?? "",
    sender_name: value?.contacts?.[0]?.profile?.name ?? null,
    mobile_no: waId.startsWith("91") ? waId.slice(2) : waId,
    msg_type: message.type ?? "",
    content: null,
    image: null,
  };

  let cartOrder = false;
  let formResponse = false;
  let formResponseData: string = "";
  switch (msg.msg_type) {
    case "text":
      msg.content = message.text?.body ?? "";
      break;
    case "order":
      msg.content = "WA Catalog Order";
      cartOrder = true;
      break;
    case "interactive": {
      const i = message.interactive ?? {};
      if (i.type === "nfm_reply") {
        formResponseData = i.nfm_reply?.response_json ?? "";
        msg.content = "Form Response";
        formResponse = true;
      } else {
        msg.content = i.button_reply?.title || i.list_reply?.title || "";
      }
      // PHP read this from the wrong path and never matched; fixed (see migration notes).
      if (i.type === "call_permission_reply" && i.call_permission_reply?.response === "accept") {
        msg.content = "Call Permission Granted";
      }
      break;
    }
    case "button":
      msg.content = message.button?.text ?? "";
      break;
    case "list":
      msg.content = message.list?.text ?? "";
      break;
    case "reaction":
    case "sticker":
      break;
    default:
      msg.content = "File_Attachment";
  }
  if (!msg.msg_type) return;
  msg.image = JSON.stringify(message[msg.msg_type] ?? null);

  const contactId = await contactFor(userId, msg.mobile_no, msg.sender_name);
  await saveIncoming(userId, msg, contactId);

  const recMobileNo = user.u_wa_no ?? "";
  const sender = { sender_name: msg.sender_name, sender_no: msg.mobile_no };

  const handleOrderOrForm = async () => {
    if (cartOrder && user.u_wa_catalogue_url) {
      let last: Record<string, unknown> = {};
      for (const item of message.order?.product_items ?? []) {
        last = {
          ...sender,
          product: item.product_retailer_id,
          product_qty: item.quantity,
          product_rate: item.item_price,
          product_currency: item.currency,
          message_id: msg.message_id,
          receiver_mobile_no: recMobileNo,
        };
        await forwardJson(user.u_wa_catalogue_url, last);
      }
      await incomingLog(userId, recMobileNo, msg.mobile_no, JSON.stringify(last), "catalogue");
    } else if (formResponse) {
      let response: Record<string, unknown> | null = null;
      try {
        response = JSON.parse(formResponseData);
      } catch {
        response = null;
      }
      let formUrl = user.u_wa_form_url ?? "";
      const out: Record<string, unknown> = {};
      if (variant === "wa") {
        const psf = psfFormOverride(userId, response);
        if (psf) {
          out.entry_type = psf.entryType;
          msg.content = psf.content;
          formUrl = psf.formUrl;
        }
      }
      Object.assign(out, { ...sender, response, message_id: msg.message_id, receiver_mobile_no: recMobileNo });
      if (formUrl) await forwardJson(formUrl, out);
      await incomingLog(userId, recMobileNo, msg.mobile_no, JSON.stringify(out), "flow", variant === "wa" ? formUrl : "");
    }
  };

  const handleIncomingUrl = async () => {
    if (!user.u_wa_incoming_url) return;
    await forwardJson(user.u_wa_incoming_url, {
      ...sender,
      message: msg.content,
      message_id: msg.message_id,
      receiver_mobile_no: recMobileNo,
    });
    if (userId === 11 && ACCESSORY_KEYWORDS.includes(msg.content ?? "")) {
      await autoReplyProductList(userId, contactId, msg.content ?? "", msg.mobile_no);
    }
  };

  // webhook.php forwards to the incoming URL first; wawebhook.php handles orders/forms first.
  if (variant === "wa") {
    await handleOrderOrForm();
    await handleIncomingUrl();
  } else {
    await handleIncomingUrl();
    await handleOrderOrForm();
  }
}

/** Queues and immediately sends the TGMA product list (status 6 = already claimed). */
async function autoReplyProductList(userId: number, contactId: number, title: string, mobileNo: string) {
  const row = await db.js_message.create({
    data: {
      m_msg_type: "product_list",
      m_contact_id: contactId,
      m_title: phpEntities(title),
      m_content: "",
      m_mobile_no: mobileNo.trim(),
      m_image: "",
      m_base_file: "",
      m_is_incoming: 2,
      m_user_id: userId,
      m_sheet_id: "Accessories_Response",
      m_source: 2,
      m_status: 6,
      m_created_date: istParts().startOfDay,
      m_created_on: now(),
    },
  });
  await sendClaimedMessages({ msgId: row.m_id, variant: "meta" });
}
