// Media helpers for the send engine: file-type detection and the "base file"
// attachments (a JSON list of base64 files stored under waapi/media/).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config, istParts } from "@/lib/config";

export type MediaType = "image" | "video" | "document";

const IMAGE = ["jpg", "jpeg", "png", "gif"];
const VIDEO = ["mpg", "mp2", "mpeg", "mpe", "mpv", "mp4", "m4p", "m4v"];

export const extOf = (name: string) => (name.split(".").pop() ?? "").toLowerCase();

export function mediaTypeOf(name: string): MediaType {
  const ext = extOf(name);
  if (IMAGE.includes(ext)) return "image";
  if (VIDEO.includes(ext)) return "video";
  return "document";
}

export const fileNameOf = (url: string) => url.trim().split("/").pop() ?? "";

/** Root folders on disk. MEDIA_ROOT is served publicly at MEDIA_URL. */
export const mediaRoot = () => process.env.MEDIA_ROOT ?? path.join(process.cwd(), "public", "media");
export const waapiMediaRoot = () => process.env.WAAPI_MEDIA_ROOT ?? path.join(process.cwd(), "storage", "waapi-media");

type BaseFileEntry = { name?: string; extension?: string; body?: string };

/** Reads a stored base-file attachment list (m_base_file). Missing/invalid file -> []. */
export async function readBaseFile(baseFile: string | null): Promise<BaseFileEntry[]> {
  if (!baseFile) return [];
  // base_file names come from our own API, but never allow escaping the folder.
  const file = path.join(waapiMediaRoot(), path.basename(baseFile));
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    return Array.isArray(parsed) ? parsed : Object.values(parsed ?? {});
  } catch {
    return [];
  }
}

/** PHP's filename clean-up: spaces -> _, strip ( ) ' "; add .pdf when there is no extension. */
export function cleanFileName(name: string): string {
  let f = name.replace(/ /g, "_").replace(/[()'"]/g, "");
  if (!f.includes(".") || f.split(".")[1] === "") f += ".pdf";
  return f;
}

export type SavedMedia = { url: string; type: MediaType; filename: string };

/**
 * Decodes base-file attachments to media/wa_msg/<yymmdd>/<user_token>/<file> and returns
 * their public URLs. Files are kept: WhatsApp downloads the link after the API call,
 * and the delete_folders job cleans the folder up later.
 */
export async function saveBaseFileMedia(entries: BaseFileEntry[], userToken: string): Promise<SavedMedia[]> {
  const { yymmdd } = istParts();
  const relDir = path.join("wa_msg", yymmdd, path.basename(userToken));
  const out: SavedMedia[] = [];
  for (const entry of entries) {
    if (!entry.body) continue;
    const filename = cleanFileName(entry.name ?? "file");
    await mkdir(path.join(mediaRoot(), relDir), { recursive: true });
    await writeFile(path.join(mediaRoot(), relDir, filename), Buffer.from(entry.body, "base64"));
    out.push({
      url: `${config.mediaUrl}${relDir.split(path.sep).join("/")}/${encodeURIComponent(filename)}`,
      type: mediaTypeOf(filename),
      filename,
    });
  }
  return out;
}
