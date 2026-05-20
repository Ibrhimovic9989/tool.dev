// Singleton Drizzle client. Uses the existing `pg` driver so we don't introduce
// a second connection library — `pg.Pool` is also what /api/test/run already
// uses for one-shot DB testing.

import "server-only";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __makemcp_pool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __makemcp_db: NodePgDatabase<typeof schema> | undefined;
}

function getPool(): Pool {
  if (globalThis.__makemcp_pool) return globalThis.__makemcp_pool;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add it to .env.local (Supabase pooler URL).",
    );
  }
  globalThis.__makemcp_pool = new Pool({
    connectionString: url,
    // Supabase pooler requires SSL.
    ssl: { rejectUnauthorized: false },
    max: 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
  return globalThis.__makemcp_pool;
}

export function getDb(): NodePgDatabase<typeof schema> {
  if (globalThis.__makemcp_db) return globalThis.__makemcp_db;
  globalThis.__makemcp_db = drizzle(getPool(), { schema });
  return globalThis.__makemcp_db;
}

export { schema };
