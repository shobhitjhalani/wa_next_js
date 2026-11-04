import pg from 'pg';
import Cursor from 'pg-cursor';
import { config } from './config';

/**
 * PostgreSQL access: one shared pool, tiny typed helpers, and insert /
 * update builders for the legacy js_* tables. SQL is written by hand with
 * $1…$n placeholders — never interpolate request values into SQL text.
 */

// int8 (bigint ids, COUNT(*)) → number; numeric → number; timestamp → "Y-m-d H:i:s" (like MySQL / PHP)
pg.types.setTypeParser(20, (v) => parseInt(v, 10));
pg.types.setTypeParser(1700, (v) => parseFloat(v));
pg.types.setTypeParser(1114, (v) => v.slice(0, 19));

export type Row = Record<string, unknown>;
export type Queryable = pg.Pool | pg.PoolClient;

const globalForDb = globalThis as unknown as { __waPool?: pg.Pool };

/** Shared pool (kept on globalThis so dev hot-reload doesn't leak connections). */
export const pool: pg.Pool =
  globalForDb.__waPool ??
  (globalForDb.__waPool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: config.dbPoolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Same wall clock as the app for now() / timestamp columns
    options: `-c timezone=${config.timezone}`,
    application_name: 'wa_next_js',
  }));

pool.on('error', (err) => console.error('[db] idle client error', err));

export async function query<T = Row>(text: string, params: unknown[] = [], db: Queryable = pool): Promise<T[]> {
  const res = await db.query(text, params as unknown[]);
  return res.rows as T[];
}

/** First row or null. */
export async function one<T = Row>(text: string, params: unknown[] = [], db: Queryable = pool): Promise<T | null> {
  const res = await db.query(text, params as unknown[]);
  return (res.rows[0] as T) ?? null;
}

/** First column of the first row, or null. */
export async function value<T = unknown>(text: string, params: unknown[] = [], db: Queryable = pool): Promise<T | null> {
  const res = await db.query({ text, values: params as unknown[], rowMode: 'array' });
  return res.rows.length ? (res.rows[0][0] as T) : null;
}

/** Rows affected by an UPDATE / DELETE / INSERT. */
export async function exec(text: string, params: unknown[] = [], db: Queryable = pool): Promise<number> {
  const res = await db.query(text, params as unknown[]);
  return res.rowCount ?? 0;
}

/** Run fn inside a transaction; rolls back on throw. */
export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

const IDENT = /^[a-z_][a-z0-9_]*$/i;
function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`Invalid SQL identifier: ${name}`);
  return name === 'systemTime' ? '"systemTime"' : name;
}

/** INSERT one row; returns the inserted row (or the given columns). */
export async function insert<T = Row>(table: string, row: Row, returning = '*', db: Queryable = pool): Promise<T> {
  const cols = Object.keys(row).filter((k) => row[k] !== undefined);
  const sql = `INSERT INTO ${ident(table)} (${cols.map(ident).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING ${returning}`;
  const res = await db.query(sql, cols.map((c) => row[c]));
  return res.rows[0] as T;
}

/**
 * Multi-row INSERT in chunks (keeps each statement under the 65k parameter
 * limit). `onConflict` is appended verbatim, e.g. 'ON CONFLICT DO NOTHING'.
 * Returns the number of rows inserted.
 */
export async function insertMany(table: string, rows: Row[], opts: { onConflict?: string; chunk?: number; db?: Queryable } = {}): Promise<number> {
  if (!rows.length) return 0;
  const cols = Object.keys(rows[0]);
  const chunk = Math.max(1, Math.min(opts.chunk ?? 1000, Math.floor(60000 / cols.length)));
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const params: unknown[] = [];
    const tuples = part.map((r) => '(' + cols.map((c) => { params.push(r[c] ?? null); return `$${params.length}`; }).join(', ') + ')');
    const sql = `INSERT INTO ${ident(table)} (${cols.map(ident).join(', ')}) VALUES ${tuples.join(', ')} ${opts.onConflict ?? ''}`;
    const res = await (opts.db ?? pool).query(sql, params);
    inserted += res.rowCount ?? 0;
  }
  return inserted;
}

/**
 * UPDATE table SET <row> WHERE <where>. `where` uses its own $1…$n, which
 * are renumbered after the SET values. Returns rows affected.
 */
export async function update(table: string, row: Row, where: string, whereParams: unknown[] = [], db: Queryable = pool): Promise<number> {
  const cols = Object.keys(row).filter((k) => row[k] !== undefined);
  if (!cols.length) return 0;
  const set = cols.map((c, i) => `${ident(c)} = $${i + 1}`).join(', ');
  const shifted = where.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + cols.length}`);
  const res = await db.query(`UPDATE ${ident(table)} SET ${set} WHERE ${shifted}`, [...cols.map((c) => row[c]), ...whereParams]);
  return res.rowCount ?? 0;
}

/** Stream a large result in batches (exports). */
export async function* cursor<T = Row>(text: string, params: unknown[] = [], batch = 2000): AsyncGenerator<T[]> {
  const client = await pool.connect();
  const cur = client.query(new Cursor(text, params as unknown[]));
  try {
    for (;;) {
      const rows = (await cur.read(batch)) as T[];
      if (!rows.length) break;
      yield rows;
    }
  } finally {
    await cur.close().catch(() => undefined);
    client.release();
  }
}

/** Escape LIKE wildcards in user input: `%${like(q)}%`. */
export function like(value: string): string {
  return value.replace(/[\\%_]/g, (m) => '\\' + m);
}

/** "$1, $2, …" placeholders starting after `offset` existing params, for IN (…) lists. */
export function placeholders(count: number, offset = 0): string {
  return Array.from({ length: count }, (_, i) => `$${i + 1 + offset}`).join(', ');
}
