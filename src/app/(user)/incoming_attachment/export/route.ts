import type { NextRequest } from 'next/server';
import { incomingCsv } from '../../incoming/export-csv';

/** GET /incoming_attachment/export — the Attachments list (current filters) as CSV, with a view link per file. */
export function GET(req: NextRequest) {
  return incomingCsv(req, true);
}
