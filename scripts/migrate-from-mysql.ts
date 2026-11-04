/**
 * Copy the Laravel / legacy MySQL data into PostgreSQL.
 *
 *   npm run import:mysql -- --mysql=mysql://root@127.0.0.1:3306/wa_js
 *   npm run import:mysql -- --mysql=… --only=js_user,js_user_templates
 *   npm run import:mysql -- --mysql=… --skip=js_message
 *   npm run import:mysql -- --mysql=… --log-db=wa_log     (legacy log tables in a second database)
 *
 * Per table: TRUNCATE the PostgreSQL table, stream every row out of MySQL and
 * into PostgreSQL with COPY (constant memory), then reset the id sequence.
 * Only columns present in both schemas are copied. js_message indexes are
 * dropped during the load and rebuilt afterwards (much faster for 3.5M rows).
 * Text is copied byte-for-byte as MySQL returns it in utf8mb4.
 */
import mysql from 'mysql2';
import pg from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

process.loadEnvFile?.('.env');

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.join('=') || 'true'];
}));

const MYSQL_URL = args.mysql ?? process.env.MYSQL_URL ?? 'mysql://root@127.0.0.1:3306/wa_js';
const LOG_DB = args['log-db'] ?? null;
const ONLY = args.only ? String(args.only).split(',') : null;
const SKIP = args.skip ? String(args.skip).split(',') : [];

// Parents before children (FKs: master value → heading, contact → user, employee data → employee)
const TABLES = [
  'js_company', 'js_core_config', 'js_master_heading', 'js_master_value', 'js_master_value_title',
  'js_m_actions', 'js_modules', 'js_modules_group', 'js_pages', 'js_banners', 'js_documents',
  'js_employee', 'js_employee_data', 'js_employee_pin', 'js_employee_rights', 'js_employee_login_log',
  'js_user', 'js_user_data', 'js_user_emails', 'js_user_active_sheets', 'js_user_data_extractor_keys',
  'js_user_recharge', 'js_payment_log', 'js_user_block_list', 'js_user_contact_list',
  'js_user_groups', 'js_user_groups_contact', 'js_user_catalogue', 'js_user_templates', 'js_user_campaign', 'js_campaign',
  'js_incoming_log', 'js_api_data_log', 'js_flow', 'js_flow_templates',
  'js_ai_knowledge_base', 'js_ai_prompt', 'js_ai_do_dont',
  'js_webhook_que', 'js_message_log', 'js_user_login_log',
  'js_message',
];
const LOG_TABLES = new Set(['js_webhook_que', 'js_message_log', 'js_user_login_log', 'js_employee_login_log']);

/** COPY text-format escaping; NUL bytes can't be stored in PostgreSQL text. */
function copyValue(v: unknown, type: string): string {
  if (v === null || v === undefined) return '\\N';
  let s: string;
  if (Buffer.isBuffer(v)) s = v.toString('utf8');
  else s = String(v);
  if (type.startsWith('timestamp')) {
    if (s.startsWith('0000-00-00')) s = '1970-01-01 00:00:00';
  } else if (type === 'jsonb') {
    try { JSON.parse(s); } catch { return '\\N'; }
  } else if (type === 'smallint' || type === 'integer' || type === 'bigint') {
    if (s === '') return '0';
  }
  return s.replace(/\u0000/g, '').replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

async function main() {
  const my = mysql.createConnection({ uri: MYSQL_URL, charset: 'utf8mb4', dateStrings: true, supportBigNumbers: true, bigNumberStrings: true });
  const myDb = new URL(MYSQL_URL).pathname.slice(1);
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL, options: `-c timezone=${process.env.TZ ?? 'Asia/Kolkata'}` });
  await pgc.connect();
  const myq = <T>(sql: string, params: unknown[] = []) => new Promise<T[]>((res, rej) => my.query(sql, params, (e, rows) => (e ? rej(e) : res(rows as T[]))));

  console.log(`MySQL ${MYSQL_URL.replace(/:[^:@/]*@/, ':***@')} → PostgreSQL ${process.env.DATABASE_URL}`);
  await pgc.query('SET session_replication_role = replica'); // skip FK checks + triggers during the load

  for (const table of TABLES) {
    if ((ONLY && !ONLY.includes(table)) || SKIP.includes(table)) continue;
    const srcDb = LOG_DB && LOG_TABLES.has(table) ? LOG_DB : myDb;

    const srcCols = (await myq<{ c: string }>('SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION', [srcDb, table])).map((r) => r.c);
    if (!srcCols.length) {
      console.log(`  - ${table}: not in ${srcDb}, skipped`);
      continue;
    }
    const pgCols = (await pgc.query<{ column_name: string; data_type: string }>(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1", [table])).rows;
    const types = new Map(pgCols.map((c) => [c.column_name, c.data_type === 'USER-DEFINED' ? 'citext' : c.data_type.replace(' without time zone', '')]));
    const cols = srcCols.filter((c) => types.has(c));
    const started = Date.now();

    let indexes: string[] = [];
    if (table === 'js_message') {
      indexes = (await pgc.query<{ indexname: string }>("SELECT indexname FROM pg_indexes WHERE tablename = 'js_message' AND indexname <> 'js_message_pkey'")).rows.map((r) => r.indexname);
      for (const ix of indexes) await pgc.query(`DROP INDEX IF EXISTS ${ix}`);
    }

    await pgc.query(`TRUNCATE ${table} CASCADE`);
    const quoted = cols.map((c) => (c === 'systemTime' ? '"systemTime"' : c));
    const copy = pgc.query(copyFrom(`COPY ${table} (${quoted.join(', ')}) FROM STDIN`));
    const colTypes = cols.map((c) => types.get(c)!);
    const source = my.query({ sql: `SELECT ${cols.map((c) => '`' + c + '`').join(', ')} FROM \`${srcDb}\`.\`${table}\``, rowsAsArray: true }).stream({ highWaterMark: 2000 });

    let n = 0;
    const lines = Readable.from((async function* () {
      let buf = '';
      for await (const row of source as AsyncIterable<unknown[]>) {
        buf += row.map((v, i) => copyValue(v, colTypes[i])).join('\t') + '\n';
        if (++n % 5000 === 0) {
          yield buf;
          buf = '';
          if (n % 250000 === 0) process.stdout.write(`    … ${table}: ${n.toLocaleString()} rows\n`);
        }
      }
      if (buf) yield buf;
    })());
    await pipeline(lines, copy);

    // Identity columns continue after the highest copied id
    const pk = (await pgc.query<{ attname: string }>(
      `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = $1::regclass AND i.indisprimary`, [table])).rows[0]?.attname;
    if (pk) {
      const seq = (await pgc.query<{ s: string | null }>('SELECT pg_get_serial_sequence($1, $2) AS s', [table, pk])).rows[0]?.s;
      if (seq) await pgc.query(`SELECT setval($1, GREATEST(COALESCE((SELECT MAX(${pk}) FROM ${table}), 0), 1))`, [seq]);
    }
    console.log(`  ✓ ${table}: ${n.toLocaleString()} rows (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  }

  await pgc.query('SET session_replication_role = origin');
  console.log('  … recreating indexes (db/schema.sql) and analyzing');
  const started = Date.now();
  await pgc.query("SET maintenance_work_mem = '512MB'");
  await pgc.query(await readFile(path.resolve('db/schema.sql'), 'utf8'));
  await pgc.query('VACUUM ANALYZE'); // visibility map → index-only scans on js_message
  console.log(`  ✓ indexes + statistics (${((Date.now() - started) / 1000).toFixed(1)}s)`);

  my.end();
  await pgc.end();
  console.log('Done. Legacy passwords keep working and are upgraded to bcrypt on next login.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
