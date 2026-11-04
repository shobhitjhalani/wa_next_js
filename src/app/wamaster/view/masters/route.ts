import { NextResponse, type NextRequest } from 'next/server';

/** GET /wamaster/view/masters?h=… (LegacyRedirectController::adminMasters). */
export function GET(req: NextRequest) {
  const heading = parseInt(req.nextUrl.searchParams.get('h') ?? '', 10) || 0;
  return heading > 0
    ? NextResponse.redirect(new URL(`/wamaster/masters/${heading}`, req.url), 301)
    : NextResponse.redirect(new URL('/wamaster/dashboard', req.url), 302);
}
