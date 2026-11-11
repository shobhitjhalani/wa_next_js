/**
 * One-off repair of text the legacy PHP app stored double-encoded (UTF-8 bytes
 * written through a latin1 connection, e.g. "ðŸ‘‹" for 👋, "â€™" for ’, "à¤¨" for
 * Hindi). The MySQL import copied it as-is, so it now shows garbled.
 *
 *   npx tsx --conditions=react-server --env-file-if-exists=.env scripts/fix-mojibake.ts            dry run: counts + samples
 *   npx tsx --conditions=react-server --env-file-if-exists=.env scripts/fix-mojibake.ts --apply    write the fixes
 *   … --only=js_user_templates,js_message
 *
 * Scans every text / varchar / citext column of tables with a single-column
 * primary key. A value is changed only when ALL its non-ASCII characters map back
 * to Windows-1252 bytes and those bytes are valid UTF-8 — so correct text (new
 * rows with emoji, genuine "Café") is never touched. Safe to run twice.
 */
import { pool } from '../src/lib/db';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? '1'];
}));
const APPLY = args.apply === '1';
const ONLY = args.only ? new Set(String(args.only).split(',')) : null;
const BATCH = 5000;
// Lookup keys, phone numbers and file names stay as they are (changing them could break matching / links)
const SKIP_TABLES = new Set(['js_master_value']);
const SKIP_COLUMN = /(mobile|phone|_wa_no|file|slug|code|url|username|password|key|token)/i;

// Windows-1252 characters for bytes 0x80–0x9F (the rest of 0x80–0xFF is Latin-1 = same code point)
const CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};
const decoder = new TextDecoder('utf-8', { fatal: true });

/** The repaired string, or null when the value isn't double-encoded UTF-8. */
export function unmangle(s: string): string | null {
  const bytes: number[] = [];
  let high = false;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) bytes.push(c);
    else if (c <= 0xff) { bytes.push(c); high = true; }
    else if (CP1252[c] !== undefined) { bytes.push(CP1252[c]); high = true; }
    else return null; // a real non-Latin character: already correct text
  }
  if (!high) return null;
  try {
    const out = decoder.decode(Uint8Array.from(bytes));
    return out === s ? null : out;
  } catch {
    return null;
  }
}

/** Fix repeatedly (some rows went through the latin1 connection twice). */
function repair(s: string): string | null {
  let cur = s;
  for (let i = 0; i < 3; i++) {
    const next = unmangle(cur);
    if (next === null) break;
    cur = next;
  }
  return cur === s ? null : cur;
}

// Prefilter: a UTF-8 lead byte (Â–ô) followed by a continuation byte as Windows-1252 text
const SUSPECT = "~ '[\\u00c2-\\u00f4][\\u0080-\\u00bf\\u20ac\\u201a\\u0192\\u201e\\u2026\\u2020\\u2021\\u02c6\\u2030\\u0160\\u2039\\u0152\\u017d\\u2018\\u2019\\u201c\\u201d\\u2022\\u2013\\u2014\\u02dc\\u2122\\u0161\\u203a\\u0153\\u017e\\u0178]'";

async function main() {
  const { rows: tables } = await pool.query<{ table: string; pk: string; cols: string[] }>(`
    SELECT c.relname AS table, (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum = i.indkey[0])::text AS pk,
           ARRAY(SELECT a.attname FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid
                  WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND t.typname IN ('text', 'varchar', 'citext', 'bpchar')
                  ORDER BY a.attnum)::text[] AS cols
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = current_schema()
      JOIN pg_index i ON i.indrelid = c.oid AND i.indisprimary AND i.indnatts = 1
     WHERE c.relkind = 'r' ORDER BY c.relname`);

  let total = 0;
  for (let { table, pk, cols } of tables) {
    cols = cols.filter((c) => !SKIP_COLUMN.test(c));
    if (!cols.length || SKIP_TABLES.has(table) || (ONLY && !ONLY.has(table))) continue;
    const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
    const where = cols.map((c) => `${q(c)} ${SUSPECT}`).join(' OR ');
    const perCol: Record<string, number> = {};
    const samples: string[] = [];
    let changedRows = 0;
    let last: unknown = null;
    // Don't let touch triggers bump "updated" columns (contacts would jump to the top of the inbox)
    const hasTriggers = APPLY && Number((await pool.query(
      `SELECT COUNT(*) AS n FROM pg_trigger WHERE tgrelid = $1::regclass AND NOT tgisinternal`, [table])).rows[0].n) > 0;
    if (hasTriggers) await pool.query(`ALTER TABLE ${q(table)} DISABLE TRIGGER USER`);
    try {
    for (;;) {
      const { rows } = await pool.query(
        `SELECT ${q(pk)} AS __pk, ${cols.map(q).join(', ')} FROM ${q(table)}
          WHERE (${where}) ${last === null ? '' : `AND ${q(pk)} > $1`} ORDER BY ${q(pk)} LIMIT ${BATCH}`,
        last === null ? [] : [last],
      );
      if (!rows.length) break;
      last = rows[rows.length - 1].__pk;
      for (const row of rows) {
        const set: Record<string, string> = {};
        for (const c of cols) {
          if (typeof row[c] !== 'string') continue;
          const fixed = repair(row[c]);
          if (fixed === null) continue;
          set[c] = fixed;
          perCol[c] = (perCol[c] ?? 0) + 1;
          if (samples.length < 3) samples.push(`${c}: ${row[c].slice(0, 60).replace(/\n/g, ' ')}  →  ${fixed.slice(0, 60).replace(/\n/g, ' ')}`);
        }
        const keys = Object.keys(set);
        if (!keys.length) continue;
        changedRows++;
        if (APPLY) {
          await pool.query(
            `UPDATE ${q(table)} SET ${keys.map((k, i) => `${q(k)} = $${i + 2}`).join(', ')} WHERE ${q(pk)} = $1`,
            [row.__pk, ...keys.map((k) => set[k])],
          );
        }
      }
    }
    } finally {
      if (hasTriggers) await pool.query(`ALTER TABLE ${q(table)} ENABLE TRIGGER USER`);
    }
    if (changedRows) {
      total += changedRows;
      console.log(`${table}: ${changedRows} row(s) ${APPLY ? 'fixed' : 'to fix'} — ${Object.entries(perCol).map(([c, n]) => `${c} ${n}`).join(', ')}`);
      for (const s of samples) console.log(`    ${s}`);
    }
  }
  console.log(`${APPLY ? 'Fixed' : 'Would fix'} ${total} row(s).${APPLY ? '' : ' Run with --apply to write.'}`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
