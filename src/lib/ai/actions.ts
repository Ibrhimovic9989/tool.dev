"use server";

import { chatJSON } from "./azure";
import type { NodeKind } from "@/lib/types";

/**
 * What the AI returns per suggested source. The `config` object is loosely
 * typed so the model can return whichever fields it could extract from the
 * user's prompt — the consumer applies them defensively.
 */
export interface SuggestedSource {
  kind: Exclude<NodeKind, "output.mcp">;
  name: string;
  description: string;
  reason: string;
  config?: {
    // REST
    baseUrl?: string;
    authKind?: "none" | "apiKey" | "bearer" | "basic";
    authHeaderName?: string;
    authSecretEnvVar?: string;

    // Database (Postgres-first; the schema is the same for MySQL/MSSQL)
    engine?: "postgres" | "mysql" | "mssql";
    host?: string;
    port?: number;
    database?: string;
    username?: string;
    /** Best-effort: an env var name the user *implied* in their prompt. */
    passwordEnvVar?: string;
    ssl?: boolean;
    /** A Postgres connection string the user pasted, if any. */
    connectionString?: string;

    // Webpage
    urls?: string[];

    // Documents
    sourceLocation?: string;
  };
}

interface DescribeResult {
  projectName: string;
  agency: string;
  description: string;
  sources: SuggestedSource[];
}

/**
 * Plain-English → starter graph. The model both names the project and pulls
 * any connection details out of the user's prompt so the canvas seeds with
 * pre-filled nodes wherever possible.
 */
export async function describeToGraph(
  prompt: string,
): Promise<DescribeResult> {
  const system = `You help non-technical government employees plan and pre-configure an MCP server.

Given the user's description, extract:
1. The project name, agency, and a short purpose statement.
2. A small set of data sources (max 5).
3. For each source, EXTRACT every piece of connection detail visible in the user's text — base URLs, database connection strings, env var names, hostnames, ports, usernames.

You MUST reply with strict JSON:
{
  "projectName": string,
  "agency": string,
  "description": string,
  "sources": [
    {
      "kind": "source.rest" | "source.database" | "source.documents" | "source.webpage",
      "name": string,                 // friendly name (no jargon)
      "description": string,
      "reason": string,
      "config": {
        // for source.rest:
        "baseUrl"?: string,
        "authKind"?: "none" | "apiKey" | "bearer" | "basic",
        "authHeaderName"?: string,
        "authSecretEnvVar"?: string,

        // for source.database:
        "engine"?: "postgres" | "mysql" | "mssql",
        "host"?: string,
        "port"?: number,
        "database"?: string,
        "username"?: string,
        "passwordEnvVar"?: string,
        "ssl"?: boolean,
        "connectionString"?: string,

        // for source.webpage:
        "urls"?: string[],

        // for source.documents:
        "sourceLocation"?: string
      }
    }
  ]
}

Rules:
- If the user pastes a Postgres URL like postgres://... or postgresql://..., return the entire URL as "connectionString" AND parse out host/port/database/username if possible. The password should NOT be returned — it lives in env vars.
- "passwordEnvVar" is the env var name that holds the *password value only*. Use names like DB_PASSWORD, SUPABASE_DB_PASSWORD, PG_PASSWORD. NEVER use connection-string env var names like DATABASE_URL, DIRECT_URL, *_URL — those hold the whole URL and would break runtime auth. If the user only mentions DATABASE_URL, set passwordEnvVar to "DB_PASSWORD" by convention.
- "authSecretEnvVar" follows the same rule: use names like API_KEY, API_TOKEN, BEARER_TOKEN — not URL-shaped names.
- For Supabase, prefer "source.database" with engine=postgres over "source.rest" unless the user specifically mentions the Supabase REST/PostgREST API.
- Prefer at most ONE source per system. Don't return both a REST and a Database source for the same Supabase project unless the user asks for both.
- Never invent connection details that weren't in the user's text.
- Names should be plain English.`;

  const result = await chatJSON<DescribeResult>([
    { role: "system", content: system },
    { role: "user", content: prompt },
  ]);

  return {
    projectName: result.projectName?.slice(0, 80) ?? "Untitled MCP",
    agency: result.agency ?? "",
    description: result.description ?? "",
    sources: Array.isArray(result.sources)
      ? result.sources.slice(0, 5).filter(
          (s) =>
            s.kind === "source.rest" ||
            s.kind === "source.database" ||
            s.kind === "source.documents" ||
            s.kind === "source.webpage",
        )
      : [],
  };
}

/**
 * Given an HTTP method + path + optional summary, produces a friendly tool
 * name (snake_case) and a 1-sentence description suitable for an LLM.
 */
export async function describeEndpoint(input: {
  method: string;
  path: string;
  summary?: string;
}): Promise<{ toolName: string; description: string }> {
  const system = `You name and describe REST API endpoints for use as MCP tools.
Reply with strict JSON: { "toolName": "snake_case_name", "description": "what this does, one sentence" }.
- toolName must be snake_case, <= 40 chars, action-oriented (e.g. "list_patients", "create_appointment").
- description must be a single sentence an AI assistant can read to decide whether to call it.`;
  const user = `Method: ${input.method.toUpperCase()}
Path: ${input.path}
${input.summary ? `Existing summary: ${input.summary}` : ""}`;
  return chatJSON([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
}
