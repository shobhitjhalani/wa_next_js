import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth';
import { exec, one } from '@/lib/db';
import { refreshUnread } from '@/lib/models';
import { downloadMedia, mediaInfo } from '@/lib/services/meta';
import { mediaDir, storeBytes } from '@/lib/services/media';
import { decodeEntities, jsonParse } from '@/lib/text';

/**
 * GET /view_attachment/{id} (IncomingController::view): download incoming
 * media from Meta once, cache it under MEDIA_PATH/attachment/<user code>/<id>.<ext>
 * and stream it (Laravel redirected to the cached /media URL instead).
 */

const MIME_EXT: Record<string, string> = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
  'image/webp': 'webp', 'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'audio/mpeg': 'mp3', 'video/mp4': 'mp4', 'video/3gp': '3gp', 'audio/aac': 'aac',
  'audio/mp4': 'm4a', 'audio/amr': 'amr', 'audio/ogg': 'ogg',
};
const EXT_MIME: Record<string, string> = Object.fromEntries(Object.entries(MIME_EXT).map(([mime, ext]) => [ext, mime]));
const EXTS = [...new Set([...Object.values(MIME_EXT), 'bin'])];

function headers(ext: string, name: string, size?: number): HeadersInit {
  return {
    'Content-Type': EXT_MIME[ext] ?? 'application/octet-stream',
    'Content-Disposition': `inline; filename="${name}"`,
    'Cache-Control': 'private, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
    ...(size !== undefined ? { 'Content-Length': String(size) } : {}),
  };
}

/** The cached copy (any extension), like glob("<id>.*"). */
async function cached(dir: string, id: number): Promise<{ file: string; ext: string; size: number } | null> {
  const found = await Promise.all(EXTS.map(async (ext) => {
    const file = path.join(/* turbopackIgnore: true */ dir, `${id}.${ext}`);
    try {
      const st = await stat(file);
      return st.isFile() ? { file, ext, size: st.size } : null;
    } catch {
      return null;
    }
  }));
  return found.find(Boolean) ?? null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) redirect('/');
  const raw = (await ctx.params).id;
  if (!/^\d+$/.test(raw)) return new Response('Not Found', { status: 404 });
  const id = Number(raw);

  const message = await one<{ m_id: number; m_mobile_no: string | null; m_is_read: number; m_image: string | null }>(
    'SELECT m_id, m_mobile_no, m_is_read, m_image FROM js_message WHERE m_id = $1 AND m_user_id = $2 AND m_is_incoming = 1',
    [id, user.u_id],
  );
  if (!message) return new Response('Not Found', { status: 404 });
  if (Number(message.m_is_read) === 2) {
    await exec('UPDATE js_message SET m_is_read = 1 WHERE m_id = $1', [id]);
    await refreshUnread(user.u_id, [message.m_mobile_no ?? '']);
  }

  const folder = 'attachment/' + (user.u_code || user.u_id);
  const existing = await cached(mediaDir(folder), id);
  if (existing) {
    return new Response(Readable.toWeb(createReadStream(existing.file)) as ReadableStream, {
      headers: headers(existing.ext, `${id}.${existing.ext}`, existing.size),
    });
  }

  const info = jsonParse<Record<string, any> | null>(decodeEntities(message.m_image ?? ''), null);
  if (!info?.id) return new Response('No attachment on this message.', { status: 404 });
  const media = await mediaInfo(user, String(info.id));
  if (!media.url) {
    return new Response(media.error?.message ?? 'Media not available (WhatsApp keeps media for 30 days).', { status: 404 });
  }
  const binary = await downloadMedia(String(media.url));
  if (!binary) return new Response('Unable to download media from WhatsApp.', { status: 502 });
  const ext = MIME_EXT[String(media.mime_type ?? '')] ?? 'bin';
  await storeBytes(binary.body, folder, `${id}.${ext}`);

  return new Response(new Uint8Array(binary.body), { headers: headers(ext, `${id}.${ext}`, binary.body.length) });
}
