import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { now } from "@/lib/config";
import { callMeta, MetaApi, type MetaUser } from "@/lib/wa/meta-api";
import { decodeEntities, phpEscape } from "./format";

const mediaRoot = () => process.env.MEDIA_ROOT ?? path.join(process.cwd(), "public", "media");

type MetaTemplate = {
  name: string;
  language?: string;
  category?: string;
  status?: string;
  components?: {
    type: string;
    format?: string;
    text?: string;
    example?: { header_handle?: string[]; body_text?: string[][] };
    buttons?: { type: string; text?: string }[];
  }[];
};

/**
 * Common::fun_get_templates_meta(): mirror the WABA's templates into js_user_templates.
 * Changes vs PHP: templates are only marked inactive after Meta actually answered
 * (PHP hid every template whenever the API call failed), all result pages are read
 * (PHP only read the first 25), and the "flow"/body-example values no longer leak
 * from one template to the next.
 */
export async function syncTemplatesFromMeta(user: MetaUser): Promise<{ synced: number; error?: string }> {
  const all: MetaTemplate[] = [];
  let after: string | undefined;
  for (let i = 0; i < 20; i++) {
    const res = await callMeta(MetaApi.Templates, user, undefined, {
      method: "GET",
      query: { limit: "100", ...(after ? { after } : {}) },
    });
    if (!res || !Array.isArray(res.data)) {
      return { synced: 0, error: res?.error?.message ?? "WhatsApp templates could not be loaded" };
    }
    all.push(...(res.data as MetaTemplate[]));
    const paging = res.paging as { next?: string; cursors?: { after?: string } } | undefined;
    after = paging?.next ? paging.cursors?.after : undefined;
    if (!after) break;
  }

  await db.js_user_templates.updateMany({ where: { ut_user_id: user.u_id }, data: { ut_status: 2 } });
  for (const t of all) {
    let headerFormat = "", headerText = "", footer = "", buttons = "", message = "", parameters = "";
    let msgType = "template";
    for (const c of t.components ?? []) {
      if (c.type === "HEADER") {
        headerFormat = c.format ?? "";
        if (c.text !== undefined) headerText = c.text;
        else if (headerFormat === "IMAGE") headerText = (c.example?.header_handle ?? []).join(",");
      }
      if (c.type === "BODY") {
        message = c.text ?? "";
        parameters = JSON.stringify(c.example ?? []);
      }
      if (c.type === "FOOTER" || c.type === "footer") footer = c.text ?? "";
      if (c.type === "BUTTONS") buttons = JSON.stringify(c.buttons ?? []);
      if (c.buttons?.some((b) => b.type === "FLOW")) msgType = "flow";
    }
    const data = {
      ut_template_type: msgType,
      ut_name: phpEscape(t.name),
      ut_header_type: headerFormat,
      ut_header: phpEscape(headerText),
      ut_footer: phpEscape(footer).slice(0, 255),
      ut_buttons: phpEscape(buttons),
      ut_message: phpEscape(message),
      ut_parameters: phpEscape(parameters),
      ut_language: t.language ?? "",
      ut_template_category: t.category ?? "",
      ut_file: "",
      ut_status: 1, // PHP set every synced template active, whatever Meta's status
      ut_user_id: user.u_id,
    };
    const existing = await db.js_user_templates.findFirst({ where: { ut_name: data.ut_name, ut_user_id: user.u_id } });
    if (existing) await db.js_user_templates.update({ where: { ut_id: existing.ut_id }, data });
    else await db.js_user_templates.create({ data: { ...data, ut_created_on: now() } });
  }
  return { synced: all.length };
}

export function activeTemplates(userId: number, title?: string) {
  return db.js_user_templates.findMany({
    where: { ut_user_id: userId, ut_status: 1, ut_dstatus: 0, ...(title ? { ut_name: title } : {}) },
    orderBy: { ut_id: "desc" },
  });
}

export function getTemplate(userId: number, id: number) {
  if (!(id > 0)) return Promise.resolve(null);
  return db.js_user_templates.findFirst({ where: { ut_id: id, ut_user_id: userId } });
}

export type TemplateView = {
  headerType: string;
  header: string;
  message: string;
  buttons: { text?: string }[];
  paramCount: number;
};

/** templates_content.php: what the preview and the parameter inputs need. */
export function templateView(t: { ut_header_type: string | null; ut_header: string | null; ut_message: string | null; ut_buttons: string | null; ut_parameters?: string | null }): TemplateView {
  const parse = <T,>(s: string | null | undefined, fb: T): T => {
    try {
      return s ? (JSON.parse(decodeEntities(s)) as T) : fb;
    } catch {
      return fb;
    }
  };
  const params = parse<{ body_text?: string[][] }>(t.ut_parameters, {});
  const buttons = parse<{ text?: string }[]>(t.ut_buttons, []);
  return {
    headerType: t.ut_header_type ?? "",
    header: decodeEntities(t.ut_header),
    message: decodeEntities(t.ut_message),
    buttons: Array.isArray(buttons) ? buttons : [],
    paramCount: params.body_text?.[0]?.length ?? 0,
  };
}

/** PHP upload name clean-up (including its odd x/X -> _ replacement). */
export function uploadName(name: string): string {
  return path
    .basename(name)
    .replace(/\\/g, "")
    .replace(/[-\s()xX]/g, "_");
}

const stamp = () => {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString();
  return d.slice(0, 19).replace(/[-T:]/g, "");
};

/** Saves an upload to media/watemplate/<YmdHis>-<name>. Returns the stored file name. */
export async function saveTemplateUpload(file: File, allowed: string[]): Promise<{ name?: string; error?: string }> {
  const clean = uploadName(file.name);
  const ext = (clean.split(".").pop() ?? "").toLowerCase();
  if (!allowed.includes(ext)) return { error: "Invalid File Extension" };
  const stored = `${stamp()}-${clean}`;
  const dir = path.join(mediaRoot(), "watemplate");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, stored), Buffer.from(await file.arrayBuffer()));
  return { name: stored };
}

/** Frontend::fun_add_templates() — local (non-Meta) templates. */
export async function saveTemplate(userId: number, form: FormData): Promise<string | null> {
  const id = Number(form.get("id") ?? 0);
  const files = form.getAll("img_value") as File[];
  const old = form.getAll("txt_old_img").map(String);
  const stored: string[] = [];
  for (let k = 0; k < Math.max(files.length, old.length); k++) {
    const f = files[k];
    if (f && typeof f === "object" && f.size > 0) {
      const r = await saveTemplateUpload(f, ["jpg", "jpeg", "png", "gif", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "mp4"]);
      if (r.error) return "Unknown Image extension";
      stored.push(r.name!);
    } else if (old[k]) {
      stored.push(old[k]);
    }
  }
  const data = {
    ut_template_type: "1", // WA_OFFICIAL, as the PHP stored it
    ut_name: phpEscape(String(form.get("txt_name") ?? "")),
    ut_message: phpEscape(String(form.get("txt_message") ?? "")),
    ut_file: stored.filter((s) => s && s !== "0").join(",").slice(0, 255),
    ut_status: 1,
    ut_user_id: userId,
    ut_created_on: now(),
  };
  if (id > 0) {
    // PHP updated by id alone; only the owner may edit now.
    await db.js_user_templates.updateMany({ where: { ut_id: id, ut_user_id: userId }, data });
  } else {
    await db.js_user_templates.create({ data });
  }
  return null;
}

export async function deleteTemplate(userId: number, id: number) {
  await db.js_user_templates.updateMany({ where: { ut_id: id, ut_user_id: userId }, data: { ut_dstatus: 1 } });
}
