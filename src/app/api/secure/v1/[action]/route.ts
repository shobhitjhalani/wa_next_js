import { handleApi } from '@/lib/integrations';

/** Public API: /api/secure/v1/{action}/ (legacy .htaccess → waapi/api.php). */
async function handler(req: Request, ctx: { params: Promise<{ action: string }> }) {
  return handleApi(req, (await ctx.params).action);
}

export { handler as GET, handler as POST };
