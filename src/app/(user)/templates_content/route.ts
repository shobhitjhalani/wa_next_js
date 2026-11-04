import { getUser } from '@/lib/auth';
import { one } from '@/lib/db';
import { COMPOSE_TEMPLATE_COLUMNS, type ComposeTemplate } from '../compose/TemplateParts';

/**
 * Template details for the compose screen (User\TemplateController::content).
 * Laravel returned two Blade fragments (ty=1 preview, ty=2 inputs); the
 * compose client component now renders both from this JSON, so one request
 * replaces two. Body: id (form-encoded or JSON). Unknown id → null.
 */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return Response.json({ message: 'Unauthenticated.' }, { status: 401 });

  let id = 0;
  try {
    const type = request.headers.get('content-type') ?? '';
    const raw = type.includes('application/json') ? (await request.json())?.id : (await request.formData()).get('id');
    id = parseInt(String(raw ?? ''), 10) || 0;
  } catch {
    id = 0;
  }
  const template = id
    ? await one<ComposeTemplate>(`SELECT ${COMPOSE_TEMPLATE_COLUMNS} FROM js_user_templates WHERE ut_id = $1 AND ut_user_id = $2`, [id, user.u_id])
    : null;
  return Response.json(template, { headers: { 'Cache-Control': 'no-store' } });
}
