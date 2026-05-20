import { NextResponse } from "next/server";
import {
  loadPublishedProject,
} from "@/lib/server/project-store";
import {
  callTool,
  listResources,
  listTools,
  readResource,
} from "@/lib/server/mcp-runtime";

export const runtime = "nodejs";
export const maxDuration = 60;

// Implements the MCP HTTP transport (a thin JSON-RPC 2.0 dispatcher). One
// route handles every MCP method. Streaming/SSE is not implemented — clients
// that don't insist on it (Claude Desktop in HTTP mode, custom apps using the
// SDK's HTTP transport) work over plain request/response.

interface JsonRpcReq {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResp {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const SERVER_INFO = { name: "makemcp", version: "0.1.0" };
const CAPABILITIES = {
  tools: { listChanged: false },
  resources: { listChanged: false, subscribe: false },
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const project = await loadPublishedProject(slug).catch(() => null);
  if (!project) {
    return new NextResponse(notFoundHtml(slug), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  const tools = listTools(project);
  const resources = listResources(project);
  return new NextResponse(statusHtml(slug, project.name, tools.length, resources.length), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const project = await loadPublishedProject(slug).catch(() => null);
  if (!project) {
    return jsonrpcError(null, -32601, "MCP server not found");
  }
  let body: JsonRpcReq;
  try {
    body = (await req.json()) as JsonRpcReq;
  } catch {
    return jsonrpcError(null, -32700, "Parse error");
  }
  const id = body.id ?? null;
  try {
    const result = await dispatch(project, body.method, body.params ?? {});
    const resp: JsonRpcResp = { jsonrpc: "2.0", id, result };
    return NextResponse.json(resp);
  } catch (e) {
    return jsonrpcError(id, -32603, e instanceof Error ? e.message : "Internal error");
  }
}

async function dispatch(
  project: import("@/lib/types").McpProject,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: "2024-11-05",
        capabilities: CAPABILITIES,
        serverInfo: SERVER_INFO,
      };

    case "ping":
      return {};

    case "tools/list":
      return { tools: listTools(project) };

    case "tools/call": {
      const name = String((params.name as string) ?? "");
      const args =
        (params.arguments as Record<string, unknown> | undefined) ?? {};
      if (!name) throw new Error("Missing tool name");
      return await callTool(project, name, args);
    }

    case "resources/list":
      return { resources: listResources(project) };

    case "resources/read": {
      const uri = String((params.uri as string) ?? "");
      if (!uri) throw new Error("Missing resource uri");
      return await readResource(project, uri);
    }

    case "notifications/initialized":
      // Client telling server it's done with init handshake — no response.
      return {};

    default:
      throw new Error(`Unsupported method: ${method}`);
  }
}

function jsonrpcError(
  id: JsonRpcResp["id"],
  code: number,
  message: string,
) {
  const resp: JsonRpcResp = { jsonrpc: "2.0", id, error: { code, message } };
  return NextResponse.json(resp, { status: 200 });
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML status pages (so visiting the URL in a browser is friendly)
// ─────────────────────────────────────────────────────────────────────────────

function statusHtml(
  slug: string,
  projectName: string,
  toolCount: number,
  resCount: number,
): string {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(projectName)} — MCP</title>
<style>
  body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:680px;margin:60px auto;padding:0 24px;color:#0f172a;line-height:1.55}
  h1{font-size:22px;margin:0 0 4px}.tag{display:inline-block;padding:2px 8px;border-radius:9999px;background:#dcfce7;color:#166534;font-size:12px;font-weight:600;margin-bottom:16px}
  code{background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:13px}.muted{color:#64748b}
  pre{background:#0b1220;color:#e2e8f0;padding:12px 14px;border-radius:8px;overflow:auto;font-size:12.5px;line-height:1.5}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:24px 0}
  .card{border:1px solid #e2e8f0;border-radius:8px;padding:14px;background:#fff}
</style></head><body>
<span class="tag">● live</span>
<h1>${escapeHtml(projectName)}</h1>
<p class="muted">Slug <code>${escapeHtml(slug)}</code> · ${toolCount} tools · ${resCount} resources</p>

<div class="grid">
  <div class="card"><strong>For AI clients</strong>
  <p class="muted" style="margin:6px 0 0">POST JSON-RPC 2.0 requests to this URL. Supported methods: <code>initialize</code>, <code>tools/list</code>, <code>tools/call</code>, <code>resources/list</code>, <code>resources/read</code>, <code>ping</code>.</p></div>
  <div class="card"><strong>For humans</strong>
  <p class="muted" style="margin:6px 0 0">This page just confirms the server is up. Try the curl example below to inspect what it exposes.</p></div>
</div>

<h2 style="font-size:15px">Quick check</h2>
<pre>curl -s -X POST "$URL" \\
  -H 'Content-Type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq</pre>
</body></html>`;
}

function notFoundHtml(slug: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>MCP not found</title>
<style>body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:580px;margin:80px auto;padding:0 24px;color:#0f172a;text-align:center}h1{font-size:22px}code{background:#f1f5f9;padding:2px 6px;border-radius:4px}</style>
</head><body>
<h1>MCP server <code>${escapeHtml(slug)}</code> not found</h1>
<p>Open the builder, click <strong>Publish</strong>, then visit the URL it gives you.</p>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
