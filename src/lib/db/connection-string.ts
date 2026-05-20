/**
 * Parse a Postgres connection string into the fields the DB config uses.
 * Accepts both `postgres://` and `postgresql://`.
 *
 * Note: password is extracted but the DB config never stores it — it's used
 * for the one-shot in-builder test only (returned separately so the caller
 * can decide what to do with it).
 */

export interface ParsedPgUrl {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
}

export function parsePostgresUrl(input: string): ParsedPgUrl | null {
  const cleaned = input.trim().replace(/^DATABASE_URL\s*=\s*/i, "");
  let u: URL;
  try {
    u = new URL(cleaned);
  } catch {
    return null;
  }
  if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") return null;
  const port = Number(u.port) || 5432;
  // path is "/dbname"
  const database = decodeURIComponent(u.pathname.replace(/^\//, "")) || "";
  return {
    host: u.hostname,
    port,
    database,
    username: decodeURIComponent(u.username || ""),
    password: decodeURIComponent(u.password || ""),
    // Default to SSL on managed providers (Supabase, RDS, etc.). Caller can
    // toggle.
    ssl: /supabase|amazonaws|render|neon|fly|railway|azure|google/i.test(u.hostname),
  };
}
