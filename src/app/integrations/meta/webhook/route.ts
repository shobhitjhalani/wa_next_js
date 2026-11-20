import { after } from 'next/server';
import { config } from '@/lib/config';
import { handshake, leadgenChanges, validSignature } from '@/lib/meta-leads';
import { processEvent, recordLeadgen } from '@/lib/services/meta-leads';
import { refreshMetaSettings } from '@/lib/services/meta-settings';

/**
 * Meta Lead Ads webhook (agency Meta App, Page object, field "leadgen"): https://<app>/integrations/meta/webhook
 * GET  — subscription handshake (META_WEBHOOK_VERIFY_TOKEN).
 * POST — X-Hub-Signature-256 checked on the raw body (META_APP_SECRET); each leadgen change is stored in the inbox
 *        (js_meta_lead_events, a leadgen_id only once) and answered 200 at once; the lead is read and saved after the
 *        response (and by the "meta-leads" job if that fails).
 * Public on purpose (Meta calls it): no session; nothing else is exempted.
 */

const MAX_BODY = 1024 * 1024;

export async function GET(req: Request) {
  await refreshMetaSettings();
  const r = handshake(new URL(req.url).searchParams, config.metaAds.webhookVerifyToken);
  return new Response(r.body, { status: r.status, headers: { 'Content-Type': 'text/plain' } });
}

export async function POST(req: Request) {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return new Response('Payload too large', { status: 413 });
  const raw = await req.text(); // the raw body: the signature is over these exact bytes
  await refreshMetaSettings();
  if (!validSignature(config.metaAds.appSecret, raw, req.headers.get('x-hub-signature-256'))) {
    if (!config.metaAds.appSecret) console.warn('[meta-leads] webhook refused: the Lead Ads app secret is not set (Settings → Meta Lead Ads Keys)');
    return new Response('Invalid signature', { status: 401 });
  }
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return new Response('Invalid JSON', { status: 400 }); }
  const changes = leadgenChanges(payload);
  if (changes.length) {
    const ids = await recordLeadgen(changes);
    if (ids.length) after(async () => { for (const id of ids) await processEvent(id).catch((e) => console.error('[meta-leads] processing failed', e)); });
  }
  return new Response('EVENT_RECEIVED', { status: 200, headers: { 'Content-Type': 'text/plain' } });
}
