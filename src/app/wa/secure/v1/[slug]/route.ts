import { handleApi } from '@/lib/integrations';

/** Legacy /wa/secure/v1/{action}-{key}: the key part is ignored, as in the Laravel route. */
async function handler(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const slug = (await ctx.params).slug;
  const dash = slug.indexOf('-');
  return handleApi(req, dash > 0 ? slug.slice(0, dash) : slug);
}

export { handler as GET, handler as POST };
