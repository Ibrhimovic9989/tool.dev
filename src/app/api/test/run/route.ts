import { NextResponse } from "next/server";
import type { McpProject, McpNode } from "@/lib/types";
import { withPgClient, fromDbSource } from "@/lib/db/pg-client";
import { callTool } from "@/lib/server/mcp-runtime";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Simulates a single MCP tool/resource invocation by running the underlying I/O
 * directly (HTTP fetch, page download). Lets non-tech users verify that what
 * they configured actually reaches their systems — without spinning up the
 * generated server.
 *
 * For databases, in-builder testing isn't supported (no driver) — the user is
 * told to use the exported smoke test instead.
 */

interface Body {
  project: McpProject;
  nodeId: string;
  /** Tool name (REST/DB) or resource name (Docs/Web) */
  target: string;
  /** Arguments for tools */
  args?: Record<string, string>;
  /** One-shot, in-memory secrets keyed by env var name */
  secrets?: Record<string, string>;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { project, nodeId, target } = body;
  const node = project?.nodes?.find((n: McpNode) => n.id === nodeId);
  if (!node) {
    return NextResponse.json({ error: "Node not found" }, { status: 404 });
  }

  const start = Date.now();
  try {
    let result: { kind: string; status?: number; body?: unknown; preview?: string };
    switch (node.data.kind) {
      case "source.rest":
        result = await testRest(node.data, target, body.args ?? {}, body.secrets ?? {});
        break;
      case "source.webpage":
        result = await testWebpage(node.data, target);
        break;
      case "source.documents": {
        // Document tools live in the MCP runtime (search / find_similar).
        // Args from the test panel arrive as strings — pass through; runtime
        // tolerates that for the fields it cares about.
        const toolResult = await callTool(project, target, body.args ?? {});
        const text =
          toolResult.content.map((c) => c.text).join("\n") ?? "";
        return NextResponse.json({
          ok: !toolResult.isError,
          durationMs: Date.now() - start,
          kind: "docs",
          preview: text.length > 6000 ? text.slice(0, 6000) + "\n…" : text,
        });
      }
      case "source.database":
        result = await testDatabase(
          node.data,
          target,
          body.secrets?.[node.data.passwordEnvVar] ?? "",
        );
        break;
      default:
        return NextResponse.json(
          { error: "This node type doesn't expose runnable targets" },
          { status: 400 },
        );
    }
    return NextResponse.json({
      ok: true,
      durationMs: Date.now() - start,
      ...result,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        durationMs: Date.now() - start,
        error: e instanceof Error ? e.message : "Unknown error",
      },
      { status: 200 }, // 200 so the client can display the failure inline
    );
  }
}

async function testRest(
  data: import("@/lib/types").RestSourceData,
  toolName: string,
  args: Record<string, string>,
  secrets: Record<string, string>,
): Promise<{ kind: "rest"; status: number; body: string; preview: string }> {
  const ep = data.endpoints.find((e) => e.toolName === toolName);
  if (!ep) throw new Error(`Endpoint "${toolName}" not found`);
  if (!data.baseUrl) throw new Error("Set the API base URL first");

  let url = data.baseUrl.replace(/\/$/, "") + ep.path;
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(args)) {
    if (v === "") continue;
    if (url.includes(`:${k}`)) {
      url = url.replace(`:${k}`, encodeURIComponent(v));
    } else if (url.includes(`{${k}}`)) {
      url = url.replace(`{${k}}`, encodeURIComponent(v));
    } else {
      query.set(k, v);
    }
  }
  const qs = query.toString();
  if (qs) url += (url.includes("?") ? "&" : "?") + qs;

  const headers: Record<string, string> = {};
  if (data.auth.kind === "apiKey" && data.auth.keyName) {
    const secret = data.auth.secretEnvVar
      ? secrets[data.auth.secretEnvVar] ?? ""
      : "";
    headers[data.auth.keyName] = secret;
  } else if (data.auth.kind === "bearer") {
    const secret = data.auth.secretEnvVar
      ? secrets[data.auth.secretEnvVar] ?? ""
      : "";
    headers["Authorization"] = `Bearer ${secret}`;
  } else if (data.auth.kind === "basic") {
    const user = data.auth.keyName ?? "";
    const secret = data.auth.secretEnvVar
      ? secrets[data.auth.secretEnvVar] ?? ""
      : "";
    headers["Authorization"] =
      "Basic " + Buffer.from(`${user}:${secret}`).toString("base64");
  }

  const res = await fetch(url, { method: ep.method, headers });
  const text = await res.text();
  const preview = text.length > 4000 ? text.slice(0, 4000) + "\n…" : text;
  return { kind: "rest", status: res.status, body: text, preview };
}

async function testWebpage(
  data: import("@/lib/types").WebpageSourceData,
  resourceName: string,
): Promise<{ kind: "web"; status: number; body: string; preview: string }> {
  const t = data.targets.find(
    (x) => x.resourceName === resourceName || x.id === resourceName,
  );
  if (!t) throw new Error(`Page "${resourceName}" not found`);
  if (!t.url) throw new Error("Set a URL first");
  const res = await fetch(t.url);
  const text = await res.text();
  const preview = text.length > 4000 ? text.slice(0, 4000) + "\n…" : text;
  return { kind: "web", status: res.status, body: text, preview };
}

async function testDatabase(
  data: import("@/lib/types").DatabaseSourceData,
  toolName: string,
  password: string,
): Promise<{ kind: "db"; body: unknown; preview: string }> {
  if (data.engine !== "postgres") {
    throw new Error(
      "Only PostgreSQL is supported for in-builder testing right now. Use 'npm test' on the downloaded code for MySQL/SQL Server.",
    );
  }
  if (!password) {
    throw new Error(
      `Password required. Paste it in the field above — the value of ${data.passwordEnvVar} on your deployment.`,
    );
  }
  const table = data.tables.find((t) => t.toolName === toolName);
  if (!table) throw new Error(`Tool "${toolName}" not found`);

  const where = table.rowFilter ? ` WHERE ${table.rowFilter}` : "";
  const sql = `SELECT * FROM "${table.schema}"."${table.name}"${where} LIMIT 25`;

  const rows = await withPgClient(fromDbSource(data, password), async (q) => {
    return q<Record<string, unknown>>(sql);
  });

  const preview =
    rows.length === 0
      ? "0 rows."
      : `${rows.length} row(s):\n` + JSON.stringify(rows, null, 2);
  return { kind: "db", body: rows, preview };
}

function testDocuments(
  data: import("@/lib/types").DocumentsSourceData,
  resourceName: string,
): { kind: "docs"; body: unknown; preview: string } {
  const c = data.collections.find((x) => x.resourceName === resourceName);
  if (!c) throw new Error(`Collection "${resourceName}" not found`);
  const preview = c.files.length
    ? `Files declared (${c.files.length}):\n` +
      c.files.map((f) => ` - ${f.name} (${(f.size / 1024).toFixed(1)} KB)`).join("\n")
    : c.sourceLocation
      ? `External location: ${c.sourceLocation}`
      : "No files yet.";
  return {
    kind: "docs",
    body: { fileCount: c.files.length, sourceLocation: c.sourceLocation ?? null },
    preview,
  };
}
