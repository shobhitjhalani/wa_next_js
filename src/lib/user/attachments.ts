import "server-only";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { config, istParts } from "@/lib/config";
import { callMeta, getWaKey, MetaApi } from "@/lib/wa/meta-api";
import { phpJsonDecode } from "./format";

// view_attachment.php: fetch an incoming media file from Meta, keep a copy under
// media/attachment/<yymmdd>/<user code>/<message id>.<ext>, and return its public URL.

const MIME_EXT: Record<string, string> = {
  "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "audio/mpeg": "mp3", "video/mp4": "mp4", "video/3gp": "3gp", "audio/aac": "acc", "audio/mp4": "mp4",
  "audio/amr": "amr", "audio/ogg": "ogg", "image/webp": "webp",
};

const mediaRoot = () => process.env.MEDIA_ROOT ?? path.join(process.cwd(), "public", "media");

export async function fetchIncomingAttachment(userId: number, msgId: bigint): Promise<{ url?: string; error?: string }> {
  const msg = await db.js_message.findFirst({
    where: { m_id: msgId, m_user_id: userId, m_is_incoming: 1 },
    include: { js_user: { select: { u_id: true, u_code: true, u_parent_id: true, u_wa_phone_id: true, u_wa_b_id: true } } },
  });
  if (!msg) return { error: "Attachment not found" };
  await db.js_message.update({ where: { m_id: msgId }, data: { m_is_read: 1 } });

  const media = phpJsonDecode<{ id?: string; mime_type?: string }>(msg.m_image);
  if (!media?.id) return { error: "This message has no downloadable media" };

  const meta = await callMeta(MetaApi.Media, msg.js_user, undefined, { method: "GET", mediaId: media.id });
  const url = typeof meta?.url === "string" ? meta.url : "";
  if (!url) return { error: `WhatsApp did not return the file: ${meta?.error?.message ?? "no response"}` };

  const ext = MIME_EXT[String(meta?.mime_type ?? media.mime_type ?? "")] ?? "bin";
  const rel = path.join("attachment", istParts().yymmdd, path.basename(msg.js_user.u_code ?? "user"));
  const file = `${msgId}.${ext}`;
  const publicUrl = `${config.mediaUrl}${rel.split(path.sep).join("/")}/${file}`;
  try {
    await access(path.join(mediaRoot(), rel, file));
    return { url: publicUrl };
  } catch {
    // not downloaded yet
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${await getWaKey()}`, "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(400_000),
  }).catch((e: Error) => ({ ok: false, status: 0, statusText: e.message }) as Response);
  if (!res.ok) return { error: `Download failed (${res.status} ${res.statusText})` };
  await mkdir(path.join(mediaRoot(), rel), { recursive: true });
  await writeFile(path.join(mediaRoot(), rel, file), Buffer.from(await res.arrayBuffer()));
  return { url: publicUrl };
}
