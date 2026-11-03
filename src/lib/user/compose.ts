import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { config, now } from "@/lib/config";
import { phpEscape, startOfTodayIst } from "./format";
import { saveTemplateUpload } from "./templates";

/** Contact list: comma separated, otherwise one per line; trimmed, de-duplicated. */
export function parseContacts(raw: string): string[] {
  const parts = raw.includes(",") ? raw.split(",") : raw.replace(/\r\n?/g, "\n").split("\n");
  return [...new Set(parts.map((p) => p.trim()).filter(Boolean))];
}

/**
 * Frontend::fun_send_template(): queue one template message per contact (m_status 1),
 * grouped under a js_user_campaign row whose unique code blocks double submits.
 */
export async function queueTemplate(userId: number, form: FormData): Promise<string> {
  const t = await db.js_user_templates.findFirst({
    where: { ut_id: Number(form.get("temp_id") ?? 0), ut_user_id: userId, ut_dstatus: 0 },
  });
  if (!t) return "Please select template";
  const contacts = parseContacts(String(form.get("txt_contact") ?? ""));
  if (!contacts.length) return "Please enter at least one mobile number";

  const params = form.getAll("body_parameters").map(String);
  const files = (form.getAll("img_value") as File[]).filter((f) => typeof f === "object" && f.size > 0);
  const urls: string[] = [];
  const errors: string[] = [];
  for (const f of files) {
    const r = await saveTemplateUpload(f, ["jpg", "jpeg", "png", "pdf", "mp4"]);
    if (r.name) urls.push(`${config.mediaUrl}watemplate/${r.name}`);
    else errors.push(r.error ?? "Upload failed");
  }
  if (files.length && !urls.length) return `Unable to Uplaod File. Please try again. ${errors.join(",")}`;

  const user = await db.js_user.findUniqueOrThrow({ where: { u_id: userId }, select: { u_is_new_no: true } });
  // Synced templates are 'template' / 'flow'; anything else (old '1' rows) is a template.
  const msgType = t.ut_template_type === "flow" ? "flow" : "template";
  const lite = t.ut_template_category === "MARKETING" && user.u_is_new_no === 1 ? 1 : 2;

  let campaign;
  try {
    campaign = await db.js_user_campaign.create({
      data: {
        uc_unique_code: String(form.get("ucode") ?? `cu_${now()}_${userId}`),
        uc_template: t.ut_name,
        uc_user_id: userId,
        uc_total_contacts: contacts.length,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return "Duplicate Campaign";
    throw e;
  }

  const t0 = now();
  const title = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(new Date()).replace(/ (\w{3}) /, "-$1-").replace(",", "");
  const res = await db.js_message.createMany({
    data: contacts.map((c) => ({
      m_msg_type: msgType,
      m_msg_template_name: t.ut_name,
      m_unique_id: randomUUID(),
      m_title: title,
      m_content: "",
      m_mobile_no: phpEscape(c.replace(/ /g, "")),
      m_msg_template_para: phpEscape(params.join(",")).slice(0, 255),
      m_image: urls.join(","),
      m_user_id: userId,
      m_sheet_id: "",
      m_campaign_id: campaign.uc_id,
      m_source: 2,
      m_is_incoming: 2,
      m_status: 1,
      m_msg_lite: lite,
      m_created_date: startOfTodayIst(),
      m_created_on: t0,
    })),
  });
  return `${res.count} Messages Successfully Added`;
}
