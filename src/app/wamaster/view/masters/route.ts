import { NextResponse, type NextRequest } from 'next/server';
import { redirectTo } from '@/lib/redirect';

/** GET /wamaster/view/masters?h=… (LegacyRedirectController::adminMasters). */
export function GET(req: NextRequest) {
  const heading = parseInt(req.nextUrl.searchParams.get('h') ?? '', 10) || 0;
  return heading > 0
    ? redirectTo(`/wamaster/masters/${heading}`, 301)
    : redirectTo('/wamaster/dashboard', 302);
}
