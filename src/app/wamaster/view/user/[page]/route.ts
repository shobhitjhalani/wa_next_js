import type { NextRequest } from 'next/server';
import { legacyUserRedirect } from '../redirect';

/** GET /wamaster/view/user/{index|view|add|wa_view|gs_view} (LegacyRedirectController::adminUser). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ page: string }> }) {
  return legacyUserRedirect(req, (await ctx.params).page);
}
