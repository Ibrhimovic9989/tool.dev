// One-shot: brings makemcp.dev's Supabase schema up to spec.
// Idempotent — safe to run repeatedly.
//
// Usage:
//   node --env-file=.env.local scripts/bootstrap-db.mjs

import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const stmts = [
  `CREATE EXTENSION IF NOT EXISTS vector;`,
  `CREATE EXTENSION IF NOT EXISTS pg_graphql;`,

  // NextAuth (Auth.js) tables — shape expected by @auth/drizzle-adapter.
  `CREATE TABLE IF NOT EXISTS users (
     id text PRIMARY KEY,
     name text,
     email text NOT NULL,
     email_verified timestamptz,
     image text
   );`,
  `CREATE TABLE IF NOT EXISTS accounts (
     user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     type text NOT NULL,
     provider text NOT NULL,
     provider_account_id text NOT NULL,
     refresh_token text,
     access_token text,
     expires_at integer,
     token_type text,
     scope text,
     id_token text,
     session_state text,
     PRIMARY KEY (provider, provider_account_id)
   );`,
  `CREATE TABLE IF NOT EXISTS sessions (
     session_token text PRIMARY KEY,
     user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     expires timestamptz NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS verification_tokens (
     identifier text NOT NULL,
     token text NOT NULL,
     expires timestamptz NOT NULL,
     PRIMARY KEY (identifier, token)
   );`,

  `CREATE TABLE IF NOT EXISTS projects (
     id text PRIMARY KEY,
     slug text NOT NULL UNIQUE,
     name text NOT NULL,
     agency text NOT NULL DEFAULT '',
     description text NOT NULL DEFAULT '',
     body jsonb NOT NULL,
     secrets jsonb NOT NULL DEFAULT '{}'::jsonb,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   );`,
  // owner_id is added separately so existing rows survive the migration —
  // it's nullable and references users.id; existing rows simply lack an owner.
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_id text REFERENCES users(id) ON DELETE SET NULL;`,
  `CREATE INDEX IF NOT EXISTS projects_owner_idx ON projects(owner_id);`,

  // Agent memory.
  `CREATE TABLE IF NOT EXISTS conversations (
     id text PRIMARY KEY,
     user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     project_id text,
     title text NOT NULL DEFAULT '',
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   );`,
  `CREATE INDEX IF NOT EXISTS conversations_user_idx ON conversations(user_id);`,
  `CREATE TABLE IF NOT EXISTS messages (
     id text PRIMARY KEY,
     conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
     role text NOT NULL,
     content text,
     tool_calls jsonb,
     tool_call_id text,
     tool_name text,
     tool_args jsonb,
     tool_result jsonb,
     created_at timestamptz NOT NULL DEFAULT now()
   );`,
  `CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(conversation_id);`,

  `CREATE TABLE IF NOT EXISTS vector_chunks (
     id text PRIMARY KEY,
     project_id text NOT NULL,
     collection_id text NOT NULL,
     file_id text NOT NULL,
     file_name text NOT NULL,
     "text" text NOT NULL,
     "source" text,
     embedding vector(1536) NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   );`,
  `CREATE INDEX IF NOT EXISTS vector_chunks_project_idx ON vector_chunks(project_id);`,
  `CREATE INDEX IF NOT EXISTS vector_chunks_collection_idx ON vector_chunks(collection_id);`,
  `CREATE INDEX IF NOT EXISTS vector_chunks_embedding_hnsw
     ON vector_chunks
     USING hnsw (embedding vector_cosine_ops);`,
];

for (const stmt of stmts) {
  const label = stmt.split("\n")[0].slice(0, 80);
  process.stdout.write(`→ ${label}… `);
  try {
    await client.query(stmt);
    console.log("ok");
  } catch (e) {
    console.log("FAIL");
    console.error(e.message);
    process.exit(1);
  }
}

// Sanity check: list extensions and tables we just touched.
const ext = await client.query(
  `SELECT extname FROM pg_extension WHERE extname IN ('vector','pg_graphql') ORDER BY extname;`,
);
console.log("\nextensions:", ext.rows.map((r) => r.extname).join(", "));
const tabs = await client.query(
  `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('projects','vector_chunks') ORDER BY tablename;`,
);
console.log("tables:    ", tabs.rows.map((r) => r.tablename).join(", "));

await client.end();
console.log("\nbootstrap done.");
