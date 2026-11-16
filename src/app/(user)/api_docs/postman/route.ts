import { getUser } from '@/lib/auth';
import { postmanCollection } from '@/lib/api/postman';
import { config } from '@/lib/config';
import { redirectTo } from '@/lib/redirect';
import { API_DOCS_VISIBLE } from '../visibility';

/** GET /api_docs/postman — the Postman collection with this account's base URL and API key filled in. */
export async function GET() {
  if (!API_DOCS_VISIBLE) return new Response('Not found', { status: 404 });
  const user = await getUser();
  if (!user) return redirectTo('/');
  const body = JSON.stringify(postmanCollection(`${config.appUrl}/api/v2`, user.u_access_code ?? ''), null, 2);
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="WA-API-v2.postman_collection.json"',
      'Cache-Control': 'no-store',
    },
  });
}
