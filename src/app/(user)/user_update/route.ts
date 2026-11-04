import { getUser } from '@/lib/auth';
import { exec } from '@/lib/db';
import { registerNumber, subscribeApp } from '@/lib/services/meta';

/**
 * Embedded Signup callback (User\DashboardController::saveWhatsAppAccount,
 * legacy user_update.php): store the phone number / WABA / business ids and
 * register the number with Meta. Accepts form-encoded or JSON bodies.
 */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return Response.json({ message: 'Unauthenticated.' }, { status: 401 });

  // Same-origin only (Laravel's CSRF check); the session cookie is SameSite=Lax as well
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (origin && (!host || URL.parse(origin)?.host !== host)) {
    return Response.json({ message: 'CSRF token mismatch.' }, { status: 419 });
  }

  let input: Record<string, unknown> = {};
  const type = request.headers.get('content-type') ?? '';
  try {
    if (type.includes('application/json')) input = (await request.json()) ?? {};
    else input = Object.fromEntries((await request.formData()).entries());
  } catch {
    input = {};
  }
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string).trim() : input[k] == null ? '' : String(input[k]));
  const phoneId = str('phone_number_id');
  const wabaId = str('waba_id');
  const businessId = str('business_id');

  const errors: Record<string, string[]> = {};
  if (!phoneId) errors.phone_number_id = ['The phone number id field is required.'];
  else if (phoneId.length > 255) errors.phone_number_id = ['The phone number id field must not be greater than 255 characters.'];
  if (wabaId.length > 255) errors.waba_id = ['The waba id field must not be greater than 255 characters.'];
  if (businessId.length > 50) errors.business_id = ['The business id field must not be greater than 50 characters.'];
  if (Object.keys(errors).length) {
    return Response.json({ message: Object.values(errors)[0][0], errors }, { status: 422 });
  }

  const ids = { u_id: user.u_id, u_wa_phone_id: phoneId, u_wa_b_id: wabaId || null, u_business_id: businessId || null };
  await exec(
    'UPDATE js_user SET u_wa_phone_id = $2, u_wa_b_id = $3, u_business_id = $4 WHERE u_id = $1',
    [ids.u_id, ids.u_wa_phone_id, ids.u_wa_b_id, ids.u_business_id],
  );

  const register = await registerNumber(ids);
  const subscribe = await subscribeApp(ids);
  console.info('WA number registered', { user: user.u_id, register, subscribe });

  return Response.json({ status: 'ok' });
}
