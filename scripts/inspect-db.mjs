import pg from "pg";

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

console.log("=== extensions ===");
const ext = await c.query(
  `SELECT extname, extversion FROM pg_extension ORDER BY extname`,
);
for (const r of ext.rows) console.log(`  ${r.extname} (v${r.extversion})`);

console.log("\n=== public tables ===");
const tabs = await c.query(`
  SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
`);
for (const r of tabs.rows) console.log(`  ${r.tablename}`);

console.log("\n=== columns ===");
for (const t of tabs.rows.map((r) => r.tablename)) {
  console.log(`  ${t}:`);
  const cols = await c.query(
    `SELECT column_name, data_type, udt_name, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [t],
  );
  for (const r of cols.rows) {
    const type = r.data_type === "USER-DEFINED" ? r.udt_name : r.data_type;
    const nn = r.is_nullable === "NO" ? " NOT NULL" : "";
    const def = r.column_default ? `  default ${r.column_default}` : "";
    console.log(`    ${r.column_name}  ${type}${nn}${def}`);
  }
}

console.log("\n=== indexes ===");
const idx = await c.query(`
  SELECT tablename, indexname, indexdef FROM pg_indexes
  WHERE schemaname = 'public' ORDER BY tablename, indexname
`);
for (const r of idx.rows) {
  console.log(`  ${r.tablename}.${r.indexname}`);
  console.log(`    ${r.indexdef}`);
}

console.log("\n=== row counts ===");
for (const t of tabs.rows.map((r) => r.tablename)) {
  const r = await c.query(`SELECT count(*)::int AS n FROM "${t}"`);
  console.log(`  ${t}: ${r.rows[0].n}`);
}

await c.end();
