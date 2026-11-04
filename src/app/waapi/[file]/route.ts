import { handleApi, handleClientApi, handleShopify, instagramWebhook, webhookReceive, webhookVerify } from '@/lib/integrations';

/**
 * Legacy file URLs under /waapi, kept so existing clients and the Meta app
 * configuration keep working:
 *   api.php?at=…, client_api.php?at=send_wa, shopify.php?at=…,
 *   webhook, webhook.php, wawebhook.php (Meta), igwebhook.php, newwebhook.php (log + ack).
 */
const WEBHOOK = new Set(['webhook', 'webhook.php', 'wawebhook.php']);
const INSTAGRAM = new Set(['igwebhook.php', 'newwebhook.php']);

type Ctx = { params: Promise<{ file: string }> };
const at = (req: Request) => new URL(req.url).searchParams.get('at') ?? '';

export async function GET(req: Request, ctx: Ctx) {
  const file = (await ctx.params).file;
  if (WEBHOOK.has(file)) return webhookVerify(req);
  if (INSTAGRAM.has(file)) return instagramWebhook(req);
  if (file === 'api.php') return handleApi(req, at(req));
  if (file === 'client_api.php') return handleClientApi(req);
  return new Response('Not Found', { status: 404 });
}

export async function POST(req: Request, ctx: Ctx) {
  const file = (await ctx.params).file;
  if (WEBHOOK.has(file)) return webhookReceive(req);
  if (INSTAGRAM.has(file)) return instagramWebhook(req);
  if (file === 'api.php') return handleApi(req, at(req));
  if (file === 'client_api.php') return handleClientApi(req);
  if (file === 'shopify.php') return handleShopify(req, at(req));
  return new Response('Not Found', { status: 404 });
}
