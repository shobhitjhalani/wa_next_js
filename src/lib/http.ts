import 'server-only';
import { cursor, type Row } from './db';

/**
 * Route Handler helpers: streamed CSV exports (constant memory, first bytes
 * immediately — the Laravel exports built the whole file first).
 */

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(cells: unknown[]): string {
  return cells.map(csvCell).join(',') + '\r\n';
}

/**
 * Stream a CSV download from a SQL query. `map` turns each row into cells.
 *
 *   return csvResponse('contacts.csv', ['Name', 'Mobile'], sql, params, (r) => [r.cl_name, r.cl_mobile_no]);
 */
export function csvResponse<T extends Row = Row>(filename: string, header: string[], sql: string, params: unknown[], map: (row: T, index: number) => unknown[]): Response {
  const enc = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(enc.encode('﻿' + csvLine(header))); // BOM so Excel reads UTF-8
        for await (const batch of cursor<T>(sql, params, 5000)) {
          controller.enqueue(enc.encode(batch.map((r) => csvLine(map(r, i++))).join('')));
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=UTF-8',
      'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
      'Cache-Control': 'no-store',
    },
  });
}

/** CSV download from rows already in memory. */
export function csvFromRows(filename: string, header: string[], rows: unknown[][]): Response {
  const body = '﻿' + csvLine(header) + rows.map(csvLine).join('');
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=UTF-8',
      'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
      'Cache-Control': 'no-store',
    },
  });
}

/** Single value from URLSearchParams / Next searchParams. */
export function sp(params: Record<string, string | string[] | undefined> | URLSearchParams, key: string): string {
  if (params instanceof URLSearchParams) return (params.get(key) ?? '').trim();
  const v = params[key];
  return (Array.isArray(v) ? v[0] ?? '' : v ?? '').trim();
}

/** All values of a repeated query key (?group=1&group=2 or group[]=1). */
export function spAll(params: Record<string, string | string[] | undefined> | URLSearchParams, key: string): string[] {
  if (params instanceof URLSearchParams) return [...params.getAll(key), ...params.getAll(key + '[]')];
  const out: string[] = [];
  for (const k of [key, key + '[]']) {
    const v = params[k];
    if (Array.isArray(v)) out.push(...v);
    else if (v !== undefined) out.push(v);
  }
  return out;
}
