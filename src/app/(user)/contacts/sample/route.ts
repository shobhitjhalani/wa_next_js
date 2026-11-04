import { NextResponse, type NextRequest } from 'next/server';
import { getUser } from '@/lib/auth';

/** GET /contacts/sample — sample file showing the expected columns (ContactController::sample). */
export async function GET(req: NextRequest) {
  if (!(await getUser())) return NextResponse.redirect(new URL('/', req.url));
  return new Response('Mobile,Name\n9876543210,Ravi Kumar\n919812345678,Priya Sharma\n+971501234567,Ahmed\n', {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="contacts-sample.csv"',
    },
  });
}
