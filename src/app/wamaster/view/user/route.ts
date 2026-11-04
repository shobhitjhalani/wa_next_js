import type { NextRequest } from 'next/server';
import { legacyUserRedirect } from './redirect';

/** GET /wamaster/view/user?ut=…&id=… (LegacyRedirectController::adminUser, page = index). */
export function GET(req: NextRequest) {
  return legacyUserRedirect(req, 'index');
}
