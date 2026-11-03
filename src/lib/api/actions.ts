// Action dispatch for waapi/api.php (?at=<action>) and waapi/client_api.php.
import { db } from "@/lib/db";
import { appLog } from "@/lib/wa/webhook-store";
import { apiUser, saveBase64File, type LegacyRequest } from "./legacy";
import { createWhatsapp, createWhatsappApi, createWhatsappTest } from "./messages";
import { activateDataExtractor, checkDataExtractor, deactivateDataExtractor, registerSheet, sheetStatus } from "./sheets";

/** Either a JSON body or (data extractor actions) a plain-text body. */
export type ApiOutput = { json: unknown } | { text: string };

type Envelope = { status: unknown; message: unknown; result: unknown; [k: string]: unknown };
const envelope = (status: unknown, message: unknown, result: unknown): ApiOutput => ({
  json: { status, message, result } satisfies Envelope,
});

const PARAMETER_MISSING: ApiOutput = { json: { status: "0", message: "Parameter Missing", result: [] } };
const INVALID_REQUEST = () => envelope(0, "Invalid Request ", []);

const isEmail = (v: string | undefined) => !!v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/**
 * The base64 attachment is saved only for a valid user with an active plan (as in PHP).
 * `keyAuth`: create_wa / send_message / send_template also accept access_key.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- arbitrary partner JSON (PHP arrays)
async function attachment(d: Record<string, any>, keyAuth: boolean, withRandom: boolean): Promise<string> {
  const file = d.base64File;
  if (file == null || file === "" || (Array.isArray(file) && file.length === 0)) return "";
  const user = await apiUser(d.username, d.password, keyAuth ? d.access_key : undefined);
  if (!user || user.wa_plan_status !== 1) return "";
  return saveBase64File(user.access_code, file, withRandom);
}

const fromCreate = (r: { status: string; msg: string; data: unknown }) => envelope(r.status, r.msg, r.data);

/** waapi/api.php */
export async function handleApi(req: LegacyRequest): Promise<ApiOutput> {
  const at = req.request.at;
  if (at === undefined) return PARAMETER_MISSING;
  const d = req.json ?? {};
  const post = req.post;

  switch (at) {
    // Inbound messages from the retired non-Meta WhatsApp gateway. PHP called
    // fun_save_incoming(), which no longer exists (fatal error); Meta inbound
    // traffic goes through /waapi/webhook.php instead.
    case "incoming":
      return INVALID_REQUEST();

    case "create_log":
      await appLog(
        "create_log",
        JSON.stringify(d) + JSON.stringify(req.request),
      );
      return INVALID_REQUEST();

    case "status_wa": {
      const row = d.message_id
        ? await db.js_message.findFirst({ where: { m_unique_id: String(d.message_id) }, select: { m_delivery_status: true } })
        : null;
      return envelope("200", "Success", row ? row.m_delivery_status : null);
    }

    case "create_wa":
    case "send_message": {
      const file = await attachment(d, true, true);
      const type = d.message_type ? String(d.message_type) : "text";
      return fromCreate(await createWhatsapp(type, d, file));
    }

    case "send_template": {
      const file = await attachment(d, true, true);
      const type = d.message_type ? String(d.message_type) : "template";
      return fromCreate(await createWhatsappApi(type, d, file));
    }

    case "create_wa_test":
      return fromCreate(await createWhatsappTest("1", d, await attachment(d, false, false)));

    case "create_wa_reply":
      return fromCreate(await createWhatsapp("1", d, await attachment(d, false, false)));

    case "create_wa_reply_all":
      return fromCreate(await createWhatsapp("template", d, await attachment(d, false, false)));

    case "check_js_de":
      return { text: await checkDataExtractor(post.key ?? "") };
    case "activate_js_de":
      return { text: await activateDataExtractor(post.key ?? "") };
    case "deactivate_js_de":
      return { text: await deactivateDataExtractor(post.key ?? "") };

    // WhatsApp groups belonged to the retired gateway; the Cloud API has no group messaging.
    // PHP: get_group crashed (missing fun_get_groups), update_group queued an unsendable row.
    case "get_group":
    case "update_group":
      return envelope("501", "Groups are not supported on the WhatsApp Cloud API", []);

    case "sheet_activate": {
      if (!isEmail(post.userEmail)) return envelope(1001, "Invalid Email ID", []);
      const r = await registerSheet(post);
      return envelope(r.status, r.msg, r.data);
    }

    case "sheet_status": {
      if (!isEmail(post.userEmail)) return envelope(1001, "Unable to read Email ID", []);
      if (!post.sheetId) return envelope(0, "Please Enter Correct Value", []);
      const r = await sheetStatus(post);
      return envelope(r.status, r.msg, r.data);
    }

    case "update_profile":
    default:
      return INVALID_REQUEST();
  }
}

/** waapi/client_api.php — server-to-server, authenticated by the Api-Key header. */
export async function handleClientApi(req: LegacyRequest): Promise<ApiOutput> {
  const at = req.request.at;
  await appLog(at ?? "", JSON.stringify(req.json), 0);
  if (at === undefined) return PARAMETER_MISSING;

  const expected = process.env.CLIENT_API_KEY;
  if (!expected || req.headers.get("api-key") !== expected) {
    // PHP added msg/data next to the default envelope.
    return { json: { status: "0", message: "Parameter Missing", result: [], msg: "Invalid credential", data: [] } };
  }

  switch (at) {
    case "send_wa":
      return fromCreate(await createWhatsappApi("1", req.json ?? {}));
    // create_bot called CrmApi::fun_create_update_user_bot(), which does not exist in this
    // codebase (it crashed with a fatal error); answered as not supported.
    case "create_bot":
      return envelope("501", "create_bot is not supported", []);
    default:
      return INVALID_REQUEST();
  }
}
