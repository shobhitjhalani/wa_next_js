import 'server-only';
import { notFound } from 'next/navigation';
import { config } from '@/lib/config';
import { one, query } from '@/lib/db';
import type { MasterValueRow } from '@/lib/types';

/**
 * Per-heading field layout (MasterController::fields). Keys are js_master_value
 * columns without the mv_ prefix; a "select:<heading id>" kind renders a dropdown
 * of that heading's values.
 */
export type FieldKind = 'text' | 'textarea' | 'number' | 'decimal' | 'plan_type' | `select:${number}`;
export type Fields = [key: string, label: string, kind: FieldKind][];

export function masterFields(type: number): Fields {
  const m = config.masters;
  switch (type) {
    case m.waPlan:
      return [
        ['name', 'Title', 'text'],
        ['desc', 'Description', 'textarea'],
        ['value', 'Validity (in Days)', 'number'],
        ['value1', 'Plan Type', 'plan_type'],
        ['value_decimal', 'Amount (before GST)', 'decimal'],
        ['display_order', 'Order', 'number'],
      ];
    case m.state:
      return [
        ['name', 'Name', 'text'],
        ['code', 'Code', 'text'],
        ['value', 'Country', `select:${m.country}`],
        ['value1', 'Territory', 'text'],
      ];
    case m.city:
      return [
        ['name', 'Name', 'text'],
        ['code', 'Code', 'text'],
        ['value1', 'State', `select:${m.state}`],
      ];
    case 57:
      return [
        ['name', 'Question', 'text'],
        ['desc', 'Answer', 'textarea'],
        ['value', 'Category', 'select:56'],
        ['display_order', 'Order', 'number'],
      ];
    default:
      return [
        ['name', 'Name', 'text'],
        ['code', 'Code', 'text'],
        ['desc', 'Description', 'textarea'],
        ['display_order', 'Order', 'number'],
      ];
  }
}

/** Columns a heading's form may write (whitelist for the dynamic SQL). */
export const MASTER_COLUMNS = ['name', 'code', 'desc', 'value', 'value1', 'value_decimal', 'display_order'];

export function selectHeading(kind: FieldKind): number | null {
  return kind.startsWith('select:') ? Number(kind.slice(7)) : null;
}

export interface Heading {
  mh_id: number;
  mh_name: string | null;
}

/** MasterHeading::findOrFail */
export async function findHeading(raw: string): Promise<Heading> {
  const id = /^\d+$/.test(raw) ? Number(raw) : 0;
  const head = id ? await one<Heading>('SELECT mh_id, mh_name FROM js_master_heading WHERE mh_id = $1', [id]) : null;
  if (!head) notFound();
  return head;
}

/** MasterValue::ofType($heading)->findOrFail($id) */
export async function findValue(heading: number, raw: string): Promise<MasterValueRow> {
  const id = /^\d+$/.test(raw) ? Number(raw) : 0;
  const row = id ? await one<MasterValueRow>('SELECT * FROM js_master_value WHERE mv_id = $1 AND mv_type = $2 AND mv_dstatus = 0', [id, heading]) : null;
  if (!row) notFound();
  return row;
}

/** mv_id → mv_name for the given ids (MasterValue::nameOf, batched). */
export async function namesOf(ids: unknown[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.map((v) => String(v ?? '').trim()).filter((v) => /^\d{1,18}$/.test(v) && v !== '0'))];
  if (!list.length) return new Map();
  const rows = await query<{ mv_id: number; mv_name: string | null }>('SELECT mv_id, mv_name FROM js_master_value WHERE mv_id = ANY($1::bigint[])', [list]);
  return new Map(rows.map((r) => [String(r.mv_id), r.mv_name ?? '']));
}
