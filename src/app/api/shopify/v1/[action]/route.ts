import { handleShopify } from '@/lib/integrations';

/** Shopify store webhooks: /api/shopify/v1/{new_order|abandoned_cart}/ */
export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  return handleShopify(req, (await ctx.params).action);
}
