import pg from "pg";
const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const projects = await c.query(
  "SELECT id, slug, name, updated_at FROM projects ORDER BY updated_at DESC LIMIT 5",
);
console.log("projects:");
for (const r of projects.rows) {
  console.log(`  ${r.id}  slug=${r.slug}  name=${r.name}  updated=${r.updated_at.toISOString()}`);
}
const chunks = await c.query(
  `SELECT project_id, file_name, vector_dims(embedding) AS dim, char_length("text") AS chars
   FROM vector_chunks ORDER BY created_at DESC LIMIT 5`,
);
console.log("\nvector_chunks:");
for (const r of chunks.rows) {
  console.log(`  proj=${r.project_id}  file=${r.file_name}  dim=${r.dim}  chars=${r.chars}`);
}
await c.end();
