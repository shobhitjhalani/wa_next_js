import type { NextRequest } from 'next/server';
import { one } from '@/lib/db';
import { handleCrmWebhook, validSignature, WebhookError, type CrmSettings } from '@/lib/services/crm';

/**
 * Leads CRM webhook (shown in /crm/settings): https://<app>/api/crm/<key>
 * GET  — Facebook's verification (hub.mode=subscribe, hub.verify_token, hub.challenge); without hub.* it says it is ready.
 * POST — Facebook Lead Ads "leadgen" notifications, or a lead as JSON / form fields (name, mobile, email, source, campaign, message …).
 */

const MAX_BODY = 256 * 1024;

async function settingsFor(key: string): Promise<CrmSettings | null> {
  if (!/^[A-Za-z0-9]{20,64}$/.test(key)) return null;
  return one<CrmSettings>(
    `SELECT s.* FROM js_crm_setting s JOIN js_user u ON u.u_id = s.cs_user_id AND u.u_crm = 1 AND u.u_dstatus = 0 WHERE s.cs_key = $1`, [key]);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  const s = await settingsFor((await ctx.params).key);
  if (!s) return Response.json({ ok: false, message: 'Unknown webhook URL.' }, { status: 404 });
  const q = req.nextUrl.searchParams;
  if (q.has('hub.mode') || q.has('hub.verify_token')) {
    if (q.get('hub.mode') === 'subscribe' && q.get('hub.verify_token') === s.cs_verify_token) {
      return new Response(q.get('hub.challenge') ?? '', { headers: { 'Content-Type': 'text/plain' } });
    }
    return new Response('Verify token does not match.', { status: 403 });
  }
  return Response.json({ ok: true, message: 'The CRM webhook is ready. POST leads to this URL.' });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  const s = await settingsFor((await ctx.params).key);
  if (!s) return Response.json({ ok: false, message: 'Unknown webhook URL.' }, { status: 404 });
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return Response.json({ ok: false, message: 'The body is too large.' }, { status: 413 });

  const type = req.headers.get('content-type') ?? '';
  let raw = '';
  let body: unknown;
  try {
    if (type.includes('multipart/form-data')) {
      const fd = await req.formData();
      body = Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
    } else {
      raw = await req.text();
      if (raw.length > MAX_BODY) return Response.json({ ok: false, message: 'The body is too large.' }, { status: 413 });
      body = type.includes('application/x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(raw)) : JSON.parse(raw || '{}');
    }
  } catch {
    return Response.json({ ok: false, message: 'Send the lead as JSON or form fields.' }, { status: 400 });
  }

  // Facebook signs its notifications with the app secret; when one is saved, unsigned or wrongly signed Facebook calls are refused
  const signature = req.headers.get('x-hub-signature-256');
  const fromFacebook = (body as { object?: string })?.object === 'page';
  if (s.cs_fb_app_secret && (fromFacebook || signature) && !validSignature(s.cs_fb_app_secret, raw, signature)) {
    return Response.json({ ok: false, message: 'Invalid signature.' }, { status: 403 });
  }

  try {
    const r = await handleCrmWebhook(s, body);
    return Response.json({ ok: true, saved: r.saved, duplicates: r.duplicates, lead_ids: r.leads });
  } catch (e) {
    if (e instanceof WebhookError) return Response.json({ ok: false, message: e.message }, { status: e.status });
    console.error('[crm] webhook failed', e);
    return Response.json({ ok: false, message: 'The lead could not be saved. Try again.' }, { status: 500 });
  }
}
