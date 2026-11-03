// Ports of CrmApi::fun_create_whatsapp(), fun_create_whatsapp_api() and
// fun_create_whatsapp_test(): validate the API user and queue a js_message row
// (m_status 1 = picked up by the worker; bot/OTP rows are sent straight away).
import { db } from "@/lib/db";
import { istParts, now } from "@/lib/config";
import { MsgStatus, sendClaimedMessages } from "@/lib/wa/sender";
import { apiContact, apiUser, entities, isOne, phpTitleDate, uuid, type ApiUser } from "./legacy";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- arbitrary partner JSON (PHP arrays)
type Payload = Record<string, any>;

export type CreateResult = {
  data: { id: string | number; status: string };
  msg: string;
  status: string;
};

const fail = (status: "201" | "202" | "207"): CreateResult =>
  ({
    "201": { data: { id: "0", status: "Unable to Process" }, msg: "201 : Error", status: "201" },
    "202": { data: { id: "0", status: "Invalid Username" }, msg: "202 : Invalid Username", status: "202" },
    "207": { data: { id: "0", status: "User WA Plan Expired" }, msg: "207 : User WA Plan Expired", status: "207" },
  })[status];

const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
const list = (v: unknown) => (Array.isArray(v) ? v.join(",") : v == null ? "" : String(v));
const mobileOf = (v: unknown) => list(v).replace(/ /g, "").trim();

/** Plan check shared by all create functions. */
function planError(user: ApiUser | null): CreateResult | null {
  if (user && user.wa_plan_status === 1) return null;
  if (user && user.wa_plan_status === 2) return fail("207");
  return fail("202");
}

async function insert(data: Record<string, unknown>) {
  const row = await db.js_message
    .create({
      data: {
        m_source: 2,
        m_created_date: istParts().startOfDay,
        m_created_on: now(),
        m_title: phpTitleDate(),
        ...data,
      } as Parameters<typeof db.js_message.create>[0]["data"],
    })
    .catch(() => null);
  return row;
}

/** fun_send_whatsapp($id): only rows already at status 6 (Processing) are sent. */
const sendNow = (msgId: bigint) => sendClaimedMessages({ msgId, variant: "meta" });

/** Used by send_message, create_wa, create_wa_reply, create_wa_reply_all. */
export async function createWhatsapp(msgType: string, p: Payload, fileName: string): Promise<CreateResult> {
  const user = await apiUser(p.username, p.password, p.access_key);
  const err = planError(user);
  if (err || !user) return err ?? fail("202");

  const mobile = mobileOf(p.receiverMobileNo);
  const bot = isOne(p.bot);
  const otp = isOne(p.opt);
  let type = msgType;
  if (otp) type = "Authentication";
  if (p.type != null) type = String(p.type);
  const uniqueId = uuid();

  const data: Record<string, unknown> = {
    m_msg_type: entities(type),
    m_unique_id: uniqueId,
    m_content: entities(first(p.message)),
    m_contact_id: await apiContact(user.id, mobile),
    m_mobile_no: entities(mobile),
    m_image: entities(list(p.filePathUrl)),
    m_base_file: fileName,
    m_user_id: user.id,
    m_status: bot ? MsgStatus.Processing : MsgStatus.InQueue,
    m_sheet_id: entities(p.sheet_id),
  };
  const buttons = first(p.messageButtons);
  if (buttons != null) {
    data.m_buttons = entities(buttons);
    data.m_msg_title = entities(p.title);
  }
  if (p.msg_values != null) data.m_msg_values = entities(JSON.stringify(p.msg_values));
  if (p.template != null) data.m_msg_template_name = entities(p.template);
  if (p.template_parameters != null) data.m_msg_template_para = entities(p.template_parameters);
  if (bot || otp) data.m_in_process_on = now();
  if (p.urlButtons != null) data.m_button_url = entities(p.urlButtons);

  const row = await insert(data);
  if (!row) return fail("201");
  if (bot || otp) await sendNow(row.m_id);
  return { data: { id: uniqueId, status: "Success" }, msg: "Success", status: "200" };
}

/** Used by send_template (api.php) and send_wa (client_api.php). */
export async function createWhatsappApi(msgType: string, p: Payload, fileName = ""): Promise<CreateResult> {
  const user = await apiUser(p.username, p.password, p.access_key);
  const err = planError(user);
  if (err || !user) return err ?? fail("202");

  const mobile = mobileOf(p.receiverMobileNo);
  const bot = isOne(p.bot);
  const data: Record<string, unknown> = {
    m_msg_type: entities(msgType),
    m_content: "",
    m_contact_id: await apiContact(user.id, mobile),
    m_mobile_no: entities(mobile),
    m_image: entities(p.attachment ?? ""),
    m_base_file: fileName,
    m_user_id: user.id,
    m_status: bot ? MsgStatus.Processing : MsgStatus.InQueue,
    m_sheet_id: "API",
  };
  if (p.msg_values != null) data.m_msg_values = entities(JSON.stringify(p.msg_values));
  if (p.template != null) data.m_msg_template_name = entities(p.template);
  if (p.template_parameters != null) data.m_msg_template_para = entities(p.template_parameters);
  if (p.urlButtons != null) data.m_button_url = entities(p.urlButtons);

  const row = await insert(data);
  if (!row) return fail("201");
  if (bot || isOne(p.opt)) await sendNow(row.m_id);
  return { data: { id: "0", status: "Success" }, msg: "Success", status: "200" };
}

/** create_wa_test: username/password only, row id returned, row stays queued. */
export async function createWhatsappTest(msgType: string, p: Payload, fileName: string): Promise<CreateResult> {
  const user = await apiUser(p.username, p.password);
  const err = planError(user);
  if (err || !user) return err ?? fail("202");

  const mobile = mobileOf(p.receiverMobileNo);
  const data: Record<string, unknown> = {
    m_msg_type: entities(msgType),
    m_content: entities(first(p.message)),
    m_contact_id: await apiContact(user.id, mobile),
    m_mobile_no: entities(mobile),
    m_image: entities(list(p.filePathUrl)),
    m_base_file: fileName,
    m_user_id: user.id,
    m_sheet_id: entities(p.sheet_id),
  };
  const buttons = first(p.messageButtons);
  if (buttons != null) {
    data.m_buttons = entities(buttons);
    data.m_msg_title = entities(p.title);
  }
  const row = await insert(data);
  if (!row) return fail("201");
  return { data: { id: Number(row.m_id), status: "Success" }, msg: "Success", status: "200" };
}
