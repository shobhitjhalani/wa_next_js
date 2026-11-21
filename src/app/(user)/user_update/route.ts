import { getUser } from '@/lib/auth';
import { exec } from '@/lib/db';
import { metaGet, registerNumber, subscribeApp } from '@/lib/services/meta';

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
  // Coexistence: a number that stays on the WhatsApp Business app (event FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING)
  const coexistence = str('coexistence') === '1';
  // An id Meta did not send keeps the account's current one (e.g. only the WABA was missing)
  const wabaId = str('waba_id') || (user.u_wa_b_id ?? '').trim();
  let phoneId = str('phone_number_id') || (user.u_wa_phone_id ?? '').trim();
  // Meta's coexistence message may carry only the WABA: take its phone number from the WABA
  let display = '';
  if (wabaId && (!phoneId || coexistence)) {
    const list = await metaGet(`${wabaId}/phone_numbers`, { fields: 'id,display_phone_number,verified_name' });
    const numbers = Array.isArray(list.data) ? list.data as { id?: string; display_phone_number?: string }[] : [];
    const own = numbers.find((n) => n.id === phoneId) ?? numbers[0];
    if (!phoneId && own?.id) phoneId = String(own.id);
    display = String(own?.display_phone_number ?? '');
    if (list.error) console.warn('[signup] phone numbers of the WABA not read', { user: user.u_id, waba: wabaId, error: list.error.message });
  } else if (phoneId) {
    display = String((await metaGet(phoneId, { fields: 'display_phone_number' })).display_phone_number ?? '');
  }
  const businessId = str('business_id') || (user.u_business_id ?? '').trim();

  const errors: Record<string, string[]> = {};
  if (!phoneId) errors.phone_number_id = ['Facebook did not send the phone number. Finish the signup with a phone number, or ask support to add it.'];
  else if (phoneId.length > 255) errors.phone_number_id = ['The phone number id field must not be greater than 255 characters.'];
  if (wabaId.length > 255) errors.waba_id = ['The waba id field must not be greater than 255 characters.'];
  if (businessId.length > 50) errors.business_id = ['The business id field must not be greater than 50 characters.'];
  if (Object.keys(errors).length) {
    return Response.json({ message: Object.values(errors)[0][0], errors }, { status: 422 });
  }

  const ids = { u_id: user.u_id, u_wa_phone_id: phoneId, u_wa_b_id: wabaId || null, u_business_id: businessId || null };
  const waNo = display.replace(/\D/g, '');
  await exec(
    `UPDATE js_user SET u_wa_phone_id = $2, u_wa_b_id = $3, u_business_id = $4,
            u_wa_no = CASE WHEN $5 <> '' AND COALESCE(u_wa_no, '') = '' THEN $5 ELSE u_wa_no END,
            u_wa_coexistence = CASE WHEN $6 THEN 1 ELSE u_wa_coexistence END WHERE u_id = $1`,
    [ids.u_id, ids.u_wa_phone_id, ids.u_wa_b_id, ids.u_business_id, waNo, coexistence],
  );

  // A coexistence number is already registered through the WhatsApp Business app: registering it again fails
  const register = coexistence ? { skipped: 'coexistence number (registered through the WhatsApp Business app)' } : await registerNumber(ids);
  // Subscribing the app to the WABA is what makes Meta send its webhooks (messages, statuses)
  const subscribe = wabaId ? await subscribeApp(ids) : { error: { message: 'no WABA id' } };
  console.info('WA number registered', { user: user.u_id, coexistence, phone: phoneId, waba: wabaId, register, subscribe });

  return Response.json({ status: 'ok', coexistence, webhook: !subscribe.error });
}
