// Compares MySQL and PostgreSQL after a pgloader run: exact row counts per table,
// plus a byte-for-byte check that UTF-8 text (emoji/Hindi) survived.
// Usage: MYSQL_URL=mysql://root@127.0.0.1:3306 PG_URL=postgresql:///wa_jscoretech npx tsx scripts/migrate/verify.ts
import mysql from "mysql2/promise";
import pg from "pg";

const DBS = [
  { mysql: "wa_official", schema: "public" },
  { mysql: "wa_log", schema: "log" },
];

async function main() {
  const my = await mysql.createConnection({ uri: process.env.MYSQL_URL, charset: "binary" });
  const pgc = new pg.Client({ connectionString: process.env.PG_URL });
  await pgc.connect();
  let failures = 0;

  for (const { mysql: dbName, schema } of DBS) {
    const [tables] = await my.query<mysql.RowDataPacket[]>(
      "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE'",
      [dbName],
    );
    for (const row of tables) {
      const t = String(row.t);
      const [[m]] = await my.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS c FROM \`${dbName}\`.\`${t}\``);
      const p = await pgc.query(`SELECT COUNT(*)::bigint AS c FROM "${schema}"."${t.toLowerCase()}"`).catch(() => null);
      const mc = Number(m.c);
      const pc = p ? Number(p.rows[0].c) : -1;
      const ok = mc === pc;
      if (!ok) failures++;
      console.log(`${ok ? "OK  " : "FAIL"} ${schema}.${t}: mysql=${mc} pg=${pc === -1 ? "missing" : pc}`);
    }
  }

  // UTF-8 spot check on the latest messages containing non-ASCII bytes.
  const [rows] = await my.query<mysql.RowDataPacket[]>(
    "SELECT m_id, m_content FROM wa_official.js_message WHERE m_content REGEXP '[^ -~\\n\\r\\t]' ORDER BY m_id DESC LIMIT 200",
  );
  let textBad = 0;
  for (const r of rows) {
    const expected = Buffer.from(r.m_content as Buffer).toString("utf8");
    const got = await pgc.query("SELECT m_content FROM public.js_message WHERE m_id = $1", [r.m_id]);
    if (got.rows[0]?.m_content !== expected) textBad++;
  }
  console.log(`${textBad ? "FAIL" : "OK  "} UTF-8 text check: ${rows.length - textBad}/${rows.length} messages identical`);
  failures += textBad;

  await my.end();
  await pgc.end();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
