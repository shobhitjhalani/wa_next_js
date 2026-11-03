// Run after `prisma db pull`: models in schema "public" are named after their table
// (js_message), models in schema "log" get a log_ prefix (log_js_message).
// Usage: npx tsx scripts/prisma-names.ts
import { readFileSync, writeFileSync } from "node:fs";

const file = "prisma/schema.prisma";
let src = readFileSync(file, "utf8");

const renames = new Map<string, string>();
for (const block of src.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
  const [, name, body] = block;
  const table = body.match(/@@map\("(\w+)"\)/)?.[1] ?? name;
  const schema = body.match(/@@schema\("(\w+)"\)/)?.[1] ?? "public";
  const wanted = schema === "log" ? `log_${table}` : table;
  if (wanted !== name) renames.set(name, wanted);
}

for (const [from, to] of renames) {
  src = src.replace(new RegExp(`\\b${from}\\b(?!")`, "g"), to);
}

// Drop @@map where model name now equals the table name.
src = src.replace(/^model (\w+) \{([\s\S]*?)^\}/gm, (all, name: string, body: string) =>
  all.replace(new RegExp(`\\n\\s*@@map\\("${name}"\\)`), ""),
);
// Add @@map for log_ models whose map was implicit.
src = src.replace(/^model log_(\w+) \{([\s\S]*?)^\}/gm, (all, table: string, body: string) =>
  /@@map\(/.test(body) ? all : all.replace(/(\n\s*@@schema\("log"\))/, `\n  @@map("${table}")$1`),
);

writeFileSync(file, src);
console.log(`Renamed ${renames.size} models`);
