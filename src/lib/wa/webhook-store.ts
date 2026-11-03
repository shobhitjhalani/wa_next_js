// DB helpers used by the inbound webhooks. Ports of Common::fun_webhook_que(),
// fun_app_log(), fun_contact_list() and Crm_api::fun_incoming_msg(), fun_incoming_log(),
// fun_get_user_value().
import { db } from "@/lib/db";
import { istParts, now } from "@/lib/config";
import { OPT_OUT_WORDS } from "./client-rules";

/** PHP escaped quotes as HTML entities before saving; existing rows (and the UI) expect that. */
export const phpEntities = (v: string | null | undefined) =>
  v == null ? v : v.replace(/'/g, "&#39;").replace(/"/g, "&#34;");

/** Crm_api::fun_get_user_value(): only active WhatsApp sub-users (u_type 2) count. */
export function findActiveUser(where: { u_access_code?: string; u_wa_phone_id?: string }) {
  return db.js_user.findFirst({ where: { ...where, u_dstatus: 0, u_status: 1, u_type: 2 } });
}

export type StatusEvent = {
  msg_id: string;
  msg_status: string;
  receipt_no: string;
  error_reason: unknown[];
};

/** fun_webhook_que(): delivery statuses are queued and applied later by the worker. */
export function queueStatus(status: StatusEvent, errorText: string) {
  return db.log_js_webhook_que.create({
    data: { value: JSON.stringify(status), msg_id: status.msg_id, status: status.msg_status, error: errorText },
  });
}

/** fun_app_log(): raw payload log in log.js_api_data_log. */
export function appLog(url: string, value: string, userId = 0) {
  return db.log_js_api_data_log.create({ data: { adl_url: url, adl_value: value, adl_user_id: userId } });
}

/**
 * fun_contact_list(): returns the contact id for (user, mobile), creating it if needed,
 * and filling in the name if the existing contact has none.
 */
export async function contactFor(userId: number, mobileNo: string, name?: string | null): Promise<number> {
  const existing = await db.js_user_contact_list.findFirst({ where: { cl_user_id: userId, cl_mobile_no: mobileNo } });
  if (existing) {
    if (!existing.cl_name && name) {
      await db.js_user_contact_list.update({ where: { cl_id: existing.cl_id }, data: { cl_name: name } });
    }
    return existing.cl_id;
  }
  // Unique (cl_mobile_no, cl_user_id): a concurrent webhook may have just created it.
  const row = await db.js_user_contact_list.upsert({
    where: { cl_mobile_no_cl_user_id: { cl_mobile_no: mobileNo, cl_user_id: userId } },
    create: { cl_user_id: userId, cl_mobile_no: mobileNo, ...(name ? { cl_name: name } : {}) },
    update: {},
  });
  return row.cl_id;
}

export type IncomingMessage = {
  message_id: string;
  reply_message_id: string;
  sender_name: string | null;
  mobile_no: string;
  msg_type: string;
  content: string | null;
  image: string | null;
};

/** fun_incoming_msg(): stores the incoming message; STOP-style replies add the sender to the block list. */
export async function saveIncoming(userId: number, m: IncomingMessage, contactId: number) {
  const row = await db.js_message.create({
    data: {
      m_message_id: phpEntities(m.message_id),
      m_reply_message_id: phpEntities(m.reply_message_id),
      m_sender_name: phpEntities(m.sender_name),
      m_mobile_no: phpEntities(m.mobile_no),
      m_msg_type: phpEntities(m.msg_type),
      m_content: phpEntities(m.content),
      m_image: phpEntities(m.image),
      m_user_id: userId,
      m_is_incoming: 1,
      m_contact_id: contactId,
      m_created_on: now(),
      m_created_date: istParts().startOfDay,
    },
  });
  if (OPT_OUT_WORDS.includes((m.content ?? "").toLowerCase())) {
    await db.js_user_block_list.create({
      data: { ubl_mobile_no: m.mobile_no.trim(), ubl_name: (m.sender_name ?? "").trim().slice(0, 100), ubl_user_id: userId },
    });
  }
  return row.m_id;
}

/** fun_incoming_log(): catalogue orders and flow (form) answers. */
export function incomingLog(userId: number, recPhone: string, senderPhone: string, response: string, type: string, formUrl = "") {
  return db.js_incoming_log.create({
    data: {
      il_user_id: userId,
      il_type: type,
      il_rec_phone_no: recPhone.slice(0, 25),
      il_sender_phone_no: senderPhone.slice(0, 25),
      il_response: response,
      post_url: formUrl,
    },
  });
}

/**
 * POSTs JSON to a client / partner URL (Common::fun_curl). Unlike PHP, the WhatsApp
 * access token is NOT sent along: these URLs are third parties.
 */
export async function forwardJson(url: string, data: unknown): Promise<void> {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "cache-control": "no-cache", "content-type": "application/json" },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // A slow or broken client endpoint must not break the webhook (PHP ignored errors too).
  }
}
