import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import type { DbTable } from "@/lib/types";
import { withPgClient } from "@/lib/db/pg-client";

export const runtime = "nodejs";
export const maxDuration = 30;

interface Body {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
  /** Optional comma-sep list of schemas to scan. Defaults to "public". */
  schemas?: string[];
}

interface TableRow {
  schema: string;
  name: string;
  row_estimate: number | string | null;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.host || !body.database || !body.username || !body.password) {
    return NextResponse.json(
      { error: "host, database, username and password are required" },
      { status: 400 },
    );
  }

  const schemas = body.schemas?.length ? body.schemas : ["public"];

  try {
    const tables = await withPgClient(
      {
        host: body.host,
        port: body.port || 5432,
        database: body.database,
        username: body.username,
        password: body.password,
        ssl: body.ssl ?? true,
      },
      async (q) => {
        return q<TableRow>(
          `
          SELECT
            n.nspname AS schema,
            c.relname AS name,
            c.reltuples::bigint AS row_estimate
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r','v','m','p')
            AND n.nspname = ANY($1::text[])
          ORDER BY n.nspname, c.relname
          `,
          [schemas],
        );
      },
    );

    const dbTables: DbTable[] = tables.map((t) => ({
      id: nanoid(8),
      schema: t.schema,
      name: t.name,
      toolName: `list_${t.schema === "public" ? "" : t.schema + "_"}${t.name}`
        .replace(/[^a-z0-9_]/gi, "_")
        .toLowerCase()
        .slice(0, 60),
      description: `Read rows from ${t.schema}.${t.name}${
        t.row_estimate ? ` (~${t.row_estimate} rows)` : ""
      }`,
      readOnly: true,
      enabled: true,
    }));

    return NextResponse.json({ tables: dbTables });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Couldn't connect to the database",
      },
      { status: 400 },
    );
  }
}
