import 'server-only';
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';
import { insertMany, query, tx } from '../db';
import { normalizePhone } from '../phone';
import { limit } from '../text';

/**
 * Imports contacts from a CSV / TXT / XLSX file (or pasted rows) into
 * js_user_contact_list and optionally a group. Columns are found from a
 * header row ("mobile", "phone", "name"…) or, without one, from the data.
 * Writes are set-based: one upsert per 1000 contacts.
 */

export class ImportError extends Error {}

export interface ImportResult {
  rows: number;
  valid: number;
  created: number;
  updated: number;
  unchanged: number;
  duplicates: number;
  invalid: number;
  invalid_samples: string[];
  grouped: number;
}

const CHUNK = 1000;

export async function importContacts(userId: number, file: { bytes: Buffer; extension: string }, groupId: number | null, overwriteNames: boolean): Promise<ImportResult> {
  let rows = file.extension.toLowerCase() === 'xlsx' ? await readXlsx(file.bytes) : readCsv(file.bytes);
  if (!rows.length) throw new ImportError('The file has no rows.');
  const [mobileCol, nameCol, hasHeader] = detectColumns(rows);
  if (mobileCol === null) throw new ImportError('Could not find a mobile number column. Add a header named "mobile" or put numbers in the first column.');
  if (hasHeader) rows = rows.slice(1);

  const contacts = new Map<string, string>(); // mobile → name
  const result: ImportResult = { rows: rows.length, valid: 0, created: 0, updated: 0, unchanged: 0, duplicates: 0, invalid: 0, invalid_samples: [], grouped: 0 };
  for (const row of rows) {
    const raw = String(row[mobileCol] ?? '').trim();
    if (raw === '' && !row.some((v) => String(v ?? '').trim() !== '')) {
      result.rows--; // blank line
      continue;
    }
    const mobile = normalizePhone(raw);
    if (!mobile) {
      result.invalid++;
      if (result.invalid_samples.length < 10) result.invalid_samples.push(raw === '' ? '(empty)' : limit(raw, 30));
      continue;
    }
    const name = nameCol !== null ? limit(String(row[nameCol] ?? '').trim(), 250, '') : '';
    if (contacts.has(mobile)) {
      result.duplicates++; // the first row wins; a later one only fills a missing name
      if (contacts.get(mobile) === '') contacts.set(mobile, name);
    } else {
      contacts.set(mobile, name);
    }
  }
  result.valid = contacts.size;

  const entries = [...contacts.entries()];
  for (let i = 0; i < entries.length; i += CHUNK) {
    await saveChunk(userId, entries.slice(i, i + CHUNK), groupId, overwriteNames, result);
  }
  return result;
}

async function saveChunk(userId: number, chunk: [string, string][], groupId: number | null, overwrite: boolean, result: ImportResult): Promise<void> {
  await tx(async (db) => {
    const mobiles = chunk.map(([m]) => m);
    const existing = new Map(
      (await query<{ cl_id: number; cl_mobile_no: string; cl_name: string | null }>(
        'SELECT cl_id, cl_mobile_no, cl_name FROM js_user_contact_list WHERE cl_user_id = $1 AND cl_mobile_no = ANY($2::text[])', [userId, mobiles], db,
      )).map((c) => [c.cl_mobile_no, c]),
    );

    const fresh: Record<string, unknown>[] = [];
    const renames: [number, string][] = [];
    for (const [mobile, name] of chunk) {
      const c = existing.get(mobile);
      if (!c) fresh.push({ cl_user_id: userId, cl_mobile_no: mobile, cl_name: name !== '' ? name : null });
      else if (name !== '' && name !== c.cl_name && (overwrite || !c.cl_name)) renames.push([c.cl_id, name]);
      else result.unchanged++;
    }
    if (renames.length) {
      await db.query(
        `UPDATE js_user_contact_list c SET cl_name = v.name FROM unnest($1::int[], $2::text[]) AS v(id, name) WHERE c.cl_id = v.id`,
        [renames.map((r) => r[0]), renames.map((r) => r[1])],
      );
      result.updated += renames.length;
    }
    // ON CONFLICT DO NOTHING: a number added by an incoming message meanwhile is not an error
    result.created += await insertMany('js_user_contact_list', fresh, { onConflict: 'ON CONFLICT (cl_user_id, cl_mobile_no) DO NOTHING', db });

    if (groupId) {
      const res = await db.query(
        `INSERT INTO js_user_groups_contact (group_id, contact_id)
         SELECT $1, cl_id FROM js_user_contact_list WHERE cl_user_id = $2 AND cl_mobile_no = ANY($3::text[])
         ON CONFLICT (group_id, contact_id) DO NOTHING`,
        [groupId, userId, mobiles],
      );
      result.grouped += res.rowCount ?? 0;
    }
  });
}

/**
 * [mobile column, name column, first row is a header]. Without a header the
 * mobile column is the first one holding a valid number, the name column the
 * first other column holding text.
 */
function detectColumns(rows: string[][]): [number | null, number | null, boolean] {
  let mobileCol: number | null = null;
  let nameCol: number | null = null;
  rows[0].forEach((cell, i) => {
    const label = String(cell ?? '').trim().toLowerCase();
    if (mobileCol === null && /mobile|phone|number|whats ?app|contact no|^no\.?$/.test(label)) mobileCol = i;
    else if (nameCol === null && label.includes('name')) nameCol = i;
  });
  const sample = rows.slice(0, 20);
  const width = Math.max(...sample.map((r) => r.length));
  if (mobileCol !== null) {
    // Header without a "name" column (e.g. "Customer"): use the first column holding text
    return [mobileCol, nameCol ?? textColumn(sample.slice(1), width, mobileCol), true];
  }
  for (let i = 0; i < width && mobileCol === null; i++) {
    const hits = sample.filter((r) => normalizePhone(r[i] ?? '') !== null).length;
    if (hits >= Math.max(1, Math.floor(sample.length / 2))) mobileCol = i;
  }
  // A first row whose "number" is not valid is a header we did not recognise
  const hasHeader = mobileCol !== null && normalizePhone(rows[0][mobileCol] ?? '') === null;
  nameCol = mobileCol !== null ? textColumn(hasHeader ? sample.slice(1) : sample, width, mobileCol) : null;
  return [mobileCol, nameCol, hasHeader];
}

/** First column other than the mobile one that holds letters. */
function textColumn(rows: string[][], width: number, skip: number): number | null {
  for (let i = 0; i < width; i++) {
    if (i !== skip && rows.some((r) => /\p{L}/u.test(String(r[i] ?? '')))) return i;
  }
  return null;
}

function toUtf8(bytes: Buffer): string {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  // Not valid UTF-8 (replacement characters) → treat as Windows-1252, like mb_convert_encoding
  return text.includes('�') ? new TextDecoder('windows-1252').decode(bytes) : text;
}

function readCsv(bytes: Buffer): string[][] {
  const text = toUtf8(bytes).replace(/^﻿/, ''); // Excel's UTF-8 BOM
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t', '|'].map((d) => [d, first.split(d).length - 1] as const).sort((a, b) => b[1] - a[1])[0][0];
  return parse(text, { delimiter, relax_column_count: true, relax_quotes: true, skip_empty_lines: false, bom: true }) as string[][];
}

/** First worksheet of an .xlsx, streamed so large sheets stay within memory. */
async function readXlsx(bytes: Buffer): Promise<string[][]> {
  const rows: string[][] = [];
  try {
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(bytes), { sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore', worksheets: 'emit' });
    for await (const sheet of reader) {
      for await (const row of sheet as AsyncIterable<ExcelJS.Row>) {
        const out: string[] = [];
        const values = row.values as unknown[];
        for (let c = 1; c < values.length; c++) out[c - 1] = cellText(values[c]);
        rows[row.number - 1] = out;
      }
      break; // first sheet only
    }
  } catch {
    throw new ImportError('Could not open the Excel file.');
  }
  for (let i = 0; i < rows.length; i++) rows[i] ??= [];
  return rows.map((r) => Array.from(r, (v) => v ?? ''));
}

function cellText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'number') {
    // 9.1987654321E+11 → 919876543210
    return Number.isInteger(v) ? v.toFixed(0) : String(v);
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as Record<string, any>;
    if (o.richText) return o.richText.map((t: any) => t.text).join('');
    if (o.text !== undefined) return String(o.text);
    if (o.result !== undefined) return cellText(o.result);
    return '';
  }
  return String(v);
}
