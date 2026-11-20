import type { NextRequest } from 'next/server';
import { getAccess } from '@/lib/admin-access';
import { config, url } from '@/lib/config';
import { like } from '@/lib/db';
import { csvResponse } from '@/lib/http';
import { phpDate } from '@/lib/time';

/** GET /wamaster/media/export?folder=&q= — every matching library file with its public URL (CSV). */
export async function GET(req: NextRequest) {
  if (!(await getAccess()).can('media_library')) return new Response('Forbidden', { status: 403 });
  const folder = req.nextUrl.searchParams.get('folder') ?? '';
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  return csvResponse<{ mf_folder: string; mf_name: string; mf_path: string; mf_size: string; mf_created_on: number }>(
    `${folder || 'media'}-urls.csv`,
    ['folder', 'name', 'url', 'file', 'size_bytes', 'uploaded'],
    `SELECT mf_folder, mf_name, mf_path, mf_size, mf_created_on FROM js_media_file
      WHERE ($1 = '' OR mf_folder = $1) AND ($2 = '' OR mf_name ILIKE $2 OR mf_path ILIKE $2) ORDER BY mf_folder, mf_id`,
    [folder, q ? `%${like(q)}%` : ''],
    (r) => [r.mf_folder, r.mf_name, url(`${config.mediaUrl}/${r.mf_path}`), r.mf_path.split('/').pop(), r.mf_size, phpDate('d-m-Y H:i', r.mf_created_on)],
  );
}
