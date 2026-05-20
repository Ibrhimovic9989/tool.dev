// Server-only Postgres client wrapper used for in-builder DB discovery and
// in-builder DB tool testing. We open a connection per request to keep things
// simple — this is for one-shot operations, not a hot path.

import "server-only";
import { Pool } from "pg";
import type { DatabaseSourceData } from "@/lib/types";

export interface PgConnectInput {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
}

export function fromDbSource(
  data: DatabaseSourceData,
  password: string,
): PgConnectInput {
  return {
    host: data.host,
    port: data.port,
    database: data.database,
    username: data.username,
    password,
    ssl: data.ssl,
  };
}

export async function withPgClient<T>(
  input: PgConnectInput,
  fn: (q: <R>(text: string, params?: unknown[]) => Promise<R[]>) => Promise<T>,
): Promise<T> {
  const pool = new Pool({
    host: input.host,
    port: input.port,
    database: input.database,
    user: input.username,
    password: input.password,
    ssl: input.ssl ? { rejectUnauthorized: false } : false,
    max: 2,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 5000,
  });
  try {
    return await fn(async <R>(text: string, params?: unknown[]): Promise<R[]> => {
      const res = await pool.query(text, params);
      return res.rows as R[];
    });
  } finally {
    // End in background — don't block the request
    pool.end().catch(() => {});
  }
}
