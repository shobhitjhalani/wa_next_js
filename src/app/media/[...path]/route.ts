import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { config } from '@/lib/config';

/**
 * Serves uploaded media (MEDIA_PATH) at /media/... — template header samples,
 * campaign media and chat attachments that Meta fetches by URL. Next only
 * serves /public files that existed at build time, hence this handler.
 */

const TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  mp4: 'video/mp4', '3gp': 'video/3gpp', pdf: 'application/pdf', mp3: 'audio/mpeg', ogg: 'audio/ogg',
  aac: 'audio/aac', amr: 'audio/amr', opus: 'audio/opus', txt: 'text/plain', csv: 'text/csv',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint', zip: 'application/zip', m4a: 'audio/mp4',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const parts = (await ctx.params).path.map((p) => decodeURIComponent(p));
  const root = path.resolve(config.mediaPath);
  const file = path.resolve(root, ...parts);
  if (!file.startsWith(root + path.sep)) return new Response('Not Found', { status: 404 });
  try {
    const st = await stat(file);
    if (!st.isFile()) return new Response('Not Found', { status: 404 });
    const ext = path.extname(file).slice(1).toLowerCase();
    const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    const headers: Record<string, string> = {
      ETag: etag,
      'Last-Modified': st.mtime.toUTCString(),
      // Media Library files can be replaced under the same URL: browsers re-check them (a quick 304 when unchanged)
      'Cache-Control': parts[0] === 'library' ? 'public, no-cache' : 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    };
    if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
      headers: { ...headers, 'Content-Type': TYPES[ext] ?? 'application/octet-stream', 'Content-Length': String(st.size) },
    });
  } catch {
    return new Response('Not Found', { status: 404 });
  }
}
