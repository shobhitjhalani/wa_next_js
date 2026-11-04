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
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const parts = (await ctx.params).path.map((p) => decodeURIComponent(p));
  const root = path.resolve(config.mediaPath);
  const file = path.resolve(root, ...parts);
  if (!file.startsWith(root + path.sep)) return new Response('Not Found', { status: 404 });
  try {
    const st = await stat(file);
    if (!st.isFile()) return new Response('Not Found', { status: 404 });
    const ext = path.extname(file).slice(1).toLowerCase();
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
      headers: {
        'Content-Type': TYPES[ext] ?? 'application/octet-stream',
        'Content-Length': String(st.size),
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response('Not Found', { status: 404 });
  }
}
