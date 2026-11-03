// Sends messages that a queue runner has claimed (m_status = 6 "Processing").
// Port of Common::fun_send_whatsapp_meta() / fun_send_whatsapp_template() / _meta_new().
import { db } from "@/lib/db";
import { now } from "@/lib/config";
import { CATALOGUE_USER_ID, catalogueKeywords, PDF_TO_IMAGE_SERVICE, PDF_TO_IMAGE_TEMPLATES } from "./client-rules";
import { readBaseFile, saveBaseFileMedia, type SavedMedia } from "./media";
import { callMeta, jsonRequest, type MetaResponse, type MetaUser } from "./meta-api";
import {
  buildAuthentication,
  buildCatalogue,
  buildFlow,
  buildTemplate,
  buildText,
  type QueuedMessage,
  type Step,
} from "./payloads";

/** js_message.m_status values (applicationtop.php $wastatus). */
export const MsgStatus = {
  InQueue: 1,
  Sent: 3,
  Cancelled: 4,
  SystemCancelled: 5,
  Processing: 6,
  InvalidMobile: 7,
  ReSend: 8,
  OptOut: 9,
} as const;

export type SendOptions = {
  msgId?: bigint | number;
  userId?: number;
  /** "template" = fun_send_whatsapp_template (per-row user data, base files always processed). */
  variant?: "meta" | "template";
  log?: (line: string) => void;
};

const ok = (r: MetaResponse | null) => !!r?.messages?.length;

/** Returns how many messages were updated (PHP $msg_counter). */
export async function sendClaimedMessages(opts: SendOptions = {}): Promise<number> {
  const templateVariant = opts.variant === "template";
  const rows = await db.js_message.findMany({
    where: {
      m_is_incoming: 2,
      m_status: MsgStatus.Processing,
      m_dstatus: 0,
      m_user_id: opts.userId && opts.userId > 0 ? opts.userId : { gt: 0 },
      ...(opts.msgId ? { m_id: BigInt(opts.msgId) } : {}),
      js_user: { u_wa_plan_status: 1, u_status: 1, u_dstatus: 0 },
    },
    orderBy: { m_id: "asc" },
    include: { js_user: { select: { u_id: true, u_code: true, u_parent_id: true, u_wa_phone_id: true, u_wa_b_id: true } } },
  });

  let counter = 0;
  for (const row of rows) {
    try {
      if (await sendOne(row, row.js_user, templateVariant, opts.log)) counter++;
    } catch (e) {
      // One bad row must not stop the batch; leave it for manual review as cancelled.
      opts.log?.(`message ${row.m_id} failed: ${(e as Error).message}`);
      await db.js_message.update({
        where: { m_id: row.m_id },
        data: { m_status: MsgStatus.Cancelled, m_updated_on: now(), m_status_response: `Error: ${(e as Error).message}`.slice(0, 255) },
      });
    }
  }
  return counter;
}

type Row = Awaited<ReturnType<typeof db.js_message.findFirstOrThrow>>;
type RowUser = MetaUser & { u_code: string | null };

async function sendOne(row: Row, user: RowUser, templateVariant: boolean, log?: (l: string) => void): Promise<boolean> {
  const userId = row.m_user_id;
  const mobile = (row.m_mobile_no ?? "").trim();

  let status: number = MsgStatus.OptOut;
  let messageIds: string[] = [];
  let sendFiles: string[] = [];

  if (mobile) {
    const blocked = await db.js_user_block_list.count({ where: { ubl_mobile_no: mobile, ubl_user_id: userId } });
    if (blocked > 0) {
      await db.js_message.update({
        where: { m_id: row.m_id },
        data: { m_status: MsgStatus.OptOut, m_in_process_on: now(), m_updated_on: now(), m_status_response: "Opt Out" },
      });
    } else {
      const m: QueuedMessage = {
        msgId: row.m_id,
        userId,
        mobileNo: `91${mobile}`,
        msg: row.m_content ?? "",
        msgType: row.m_msg_type ?? "",
        title: row.m_title ?? "",
        buttons: row.m_buttons ?? "",
        extImg: row.m_image ?? "",
        templateName: row.m_msg_template_name ?? "",
        templatePara: row.m_msg_template_para ?? "",
        msgLite: row.m_msg_lite,
        btnUrl: row.m_button_url ?? "",
      };
      const result = await deliver(m, row.m_base_file, user, templateVariant);
      sendFiles = result.sendFiles;
      messageIds = result.messageIds;
      status = result.successCount > 0 ? MsgStatus.Sent : MsgStatus.Cancelled;
      if (status === MsgStatus.Sent) {
        await db.js_user.update({ where: { u_id: userId }, data: { u_last_wa_send: now() } });
      }
      if (result.error) log?.(`message ${row.m_id}: ${result.error}`);
    }
  }

  const t = now();
  const updated = await db.js_message.update({
    where: { m_id: row.m_id },
    data: {
      m_status: status,
      m_in_process_on: t,
      m_updated_on: t,
      m_message_id: messageIds.join(","),
      m_response_file_name: sendFiles.join(","),
      m_msg_id_count: messageIds.length,
      m_delivery_status: status === MsgStatus.Sent ? "sent" : "",
    },
  });

  const previous = await db.log_js_message_log.count({ where: { ml_m_id: row.m_id } });
  await db.log_js_message_log.create({
    data: { ml_m_id: row.m_id, ml_wa_id: messageIds.join(","), ml_count: previous, ml_user_id: userId },
  });

  return !!updated;
}

async function deliver(m: QueuedMessage, baseFile: string | null, user: RowUser, templateVariant: boolean) {
  const needsBase =
    m.msgType === "template" ? templateVariant || !m.extImg : m.msgType === "flow" ? !m.extImg : m.msgType === "text";
  let baseMedia: SavedMedia[] = needsBase ? await saveBaseFileMedia(await readBaseFile(baseFile), user.u_code ?? "") : [];

  const cleanup: string[] = [];
  if (m.msgType === "template" && PDF_TO_IMAGE_TEMPLATES.has(m.templateName)) {
    baseMedia = await Promise.all(
      baseMedia.map(async (b) => {
        const res = await jsonRequest(`${PDF_TO_IMAGE_SERVICE}/pdf2image`, { url: b.url });
        await new Promise((r) => setTimeout(r, 2000));
        const id = res?.imageId;
        if (!id) return b;
        cleanup.push(`${PDF_TO_IMAGE_SERVICE}/deleteimage/${id}`);
        return { ...b, url: `${PDF_TO_IMAGE_SERVICE}/getimage/${id}`, type: "image" as const };
      }),
    );
  }

  let steps: Step[] = [];
  let sendFiles: string[] = [];
  switch (m.msgType) {
    case "template":
      steps = [buildTemplate(m, baseMedia, { templateVariant })];
      break;
    case "flow":
      steps = [buildFlow(m, baseMedia)];
      break;
    case "Authentication":
      steps = [buildAuthentication(m)];
      break;
    case "catalogue":
    case "product_list": {
      if (m.userId !== CATALOGUE_USER_ID) break;
      const items = await db.js_user_catalogue.findMany({
        where: { c_user_id: m.userId, c_keyword: { in: catalogueKeywords(m.title) } },
        orderBy: { c_id: "asc" },
        select: { c_catalogue_id: true, c_model: true, c_item_id: true },
      });
      const step = buildCatalogue(m, m.msgType, items);
      if (step) steps = [step];
      break;
    }
    case "text": {
      const built = buildText(m, baseMedia);
      steps = built.steps;
      sendFiles = built.sendFiles;
      break;
    }
  }

  let successCount = 0;
  let messageIds: string[] = [];
  let error: string | undefined;
  for (const step of steps) {
    const res = await callMeta(step.api, user, step.body);
    if (ok(res)) {
      successCount++;
      if (step.ids) messageIds = res!.messages!.map((x) => x.id);
    } else {
      error = res?.error?.message ?? "no response (user has no parent WhatsApp account?)";
    }
  }

  for (const url of cleanup) await jsonRequest(url, undefined, "GET");
  return { successCount, messageIds, sendFiles, error };
}
