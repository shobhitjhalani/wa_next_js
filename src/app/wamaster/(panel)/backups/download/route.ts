import { getAdmin } from '@/lib/auth';
import { backupDownloadUrl, backupMissing } from '@/lib/services/backup';

/** GET /wamaster/backups/download?key=… → short-lived Spaces link (super admin only). */
export async function GET(req: Request) {
  const admin = await getAdmin();
  if (!admin?.isSuperAdmin) return new Response('Forbidden', { status: 403 });
  if (backupMissing().length) return new Response('Backups are not configured.', { status: 404 });
  const url = await backupDownloadUrl(new URL(req.url).searchParams.get('key') ?? '');
  if (!url) return new Response('Not found', { status: 404 });
  return Response.redirect(url, 302);
}
