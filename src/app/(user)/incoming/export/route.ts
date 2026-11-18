import type { NextRequest } from 'next/server';
import { incomingCsv } from '../export-csv';

/** GET /incoming/export — the Incoming messages list (current filters) as CSV. */
export function GET(req: NextRequest) {
  return incomingCsv(req, false);
}
