import type { NextRequest } from 'next/server';
import { getAdmin } from '@/lib/auth';
import { crmWaSettings, previewImage } from '@/lib/services/expiry-report';

/** GET /wamaster/settings/crm_wa/preview?r=expiry|limit: the first report image as it would be sent now (super admin). */
export async function GET(req: NextRequest) {
  const admin = await getAdmin();
  if (!admin?.isSuperAdmin) return new Response('Unauthorized', { status: 401 });
  const key = req.nextUrl.searchParams.get('r') === 'limit' ? 'limit' : 'expiry';
  const png = await previewImage(await crmWaSettings(), key);
  if (!png) return new Response('No users in this report today.', { status: 404 });
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } });
}
