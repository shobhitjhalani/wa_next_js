// Recreates primary keys, unique keys, indexes and foreign keys in PostgreSQL from
// MySQL's information_schema. Runs after pgloader, which does not create them
// against this MariaDB version. Safe to re-run (IF NOT EXISTS / existing ones skipped).
// Usage: MYSQL_URL=... PG_URL=... npx tsx scripts/migrate/indexes.ts
import mysql from "mysql2/promise";
import pg from "pg";

const DBS = [
  { mysql: "wa_official", schema: "public" },
  { mysql: "wa_log", schema: "log" },
];

const q = (id: string) => `"${id.toLowerCase()}"`;

async function main() {
  const my = await mysql.createConnection({ uri: process.env.MYSQL_URL });
  const pgc = new pg.Client({ connectionString: process.env.PG_URL });
  await pgc.connect();
  let failed = 0;

  const run = async (label: string, sql: string) => {
    try {
      await pgc.query(sql);
      console.log(`OK   ${label}`);
    } catch (e) {
      const msg = (e as Error).message;
      if (/already exists|multiple primary keys/.test(msg)) return console.log(`SKIP ${label} (exists)`);
      // A few MySQL FKs point at tables that were dropped long ago; nothing to recreate.
      if (/relation .* does not exist/.test(msg)) return console.log(`WARN ${label}: target missing in MySQL too`);
      failed++;
      console.log(`FAIL ${label}: ${msg}`);
    }
  };

  for (const { mysql: dbName, schema } of DBS) {
    const [stats] = await my.query<mysql.RowDataPacket[]>(
      `SELECT table_name AS t, index_name AS i, non_unique AS nu, column_name AS c, seq_in_index AS s
         FROM information_schema.statistics WHERE table_schema = ? ORDER BY t, i, s`,
      [dbName],
    );
    const indexes = new Map<string, { t: string; i: string; unique: boolean; cols: string[] }>();
    for (const r of stats) {
      const key = `${r.t}.${r.i}`;
      if (!indexes.has(key)) indexes.set(key, { t: r.t, i: r.i, unique: Number(r.nu) === 0, cols: [] });
      indexes.get(key)!.cols.push(r.c);
    }

    for (const { t, i, unique, cols } of indexes.values()) {
      const table = `${q(schema)}.${q(t)}`;
      const colList = cols.map(q).join(", ");
      if (i === "PRIMARY") {
        await run(`${schema}.${t} PRIMARY KEY (${cols})`, `ALTER TABLE ${table} ADD PRIMARY KEY (${colList})`);
      } else {
        // Postgres index names are per schema, so prefix with the table name.
        const name = q(`${t}_${i}`.slice(0, 63));
        await run(
          `${schema}.${t} ${unique ? "UNIQUE " : ""}INDEX ${i} (${cols})`,
          `CREATE ${unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${name} ON ${table} (${colList})`,
        );
      }
    }

    const [fks] = await my.query<mysql.RowDataPacket[]>(
      `SELECT k.constraint_name AS n, k.table_name AS t, k.column_name AS c,
              k.referenced_table_name AS rt, k.referenced_column_name AS rc, r.delete_rule AS del
         FROM information_schema.key_column_usage k
         JOIN information_schema.referential_constraints r
           ON r.constraint_schema = k.constraint_schema AND r.constraint_name = k.constraint_name
        WHERE k.table_schema = ? AND k.referenced_table_name IS NOT NULL`,
      [dbName],
    );
    for (const f of fks) {
      const onDelete = f.del === "CASCADE" ? " ON DELETE CASCADE" : f.del === "SET NULL" ? " ON DELETE SET NULL" : "";
      await run(
        `${schema}.${f.t} FK ${f.c} -> ${f.rt}.${f.rc}`,
        // MySQL names an FK and its index the same; Postgres/Prisma need distinct names.
        `ALTER TABLE ${q(schema)}.${q(f.t)} ADD CONSTRAINT ${q(`${f.t}_${f.n}`.slice(0, 58) + "_fkey")}
           FOREIGN KEY (${q(f.c)}) REFERENCES ${q(schema)}.${q(f.rt)} (${q(f.rc)})${onDelete}`,
      );
    }
  }

  await pgc.query("ANALYZE");
  await my.end();
  await pgc.end();
  console.log(failed ? `\n${failed} statement(s) failed` : "\nAll keys and indexes created");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
