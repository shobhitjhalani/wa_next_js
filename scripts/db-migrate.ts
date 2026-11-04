/**
 * Create / update the PostgreSQL schema (db/schema.sql is idempotent).
 *   npm run db:migrate
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

process.loadEnvFile?.('.env');

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(await readFile(path.resolve('db/schema.sql'), 'utf8'));
  await client.end();
  console.log('Schema is up to date.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
