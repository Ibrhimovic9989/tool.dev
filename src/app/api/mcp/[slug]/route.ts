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
  req: Request,
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
  const url = new URL(req.url);
  const fullUrl = `${url.origin}/api/mcp/${slug}`;
  return new NextResponse(
    statusHtml({
      slug,
      url: fullUrl,
      name: project.name,
      agency: project.agency,
      description: project.description,
      tools,
      resources,
    }),
    {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
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

function statusHtml(args: {
  slug: string;
  url: string;
  name: string;
  agency: string;
  description: string;
  tools: { name: string; description: string }[];
  resources: { name: string; description: string }[];
}): string {
  const { slug, url, name, agency, description, tools, resources } = args;
  const toolsCount = tools.length;
  const resCount = resources.length;
  const isEmpty = toolsCount === 0 && resCount === 0;

  // Config snippets for popular MCP clients. We escape both for safe
  // embedding inside <pre> and for the JS clipboard handlers below.
  const claudeConfig = JSON.stringify(
    {
      mcpServers: {
        [slug]: {
          command: "npx",
          args: ["-y", "mcp-remote", url],
        },
      },
    },
    null,
    2,
  );
  const cursorConfig = JSON.stringify(
    {
      mcpServers: {
        [slug]: { url },
      },
    },
    null,
    2,
  );
  const curlCmd = `curl -s -X POST "${url}" \\\n  -H 'Content-Type: application/json' \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`;

  const toolsListHtml = isEmpty
    ? `<div class="empty">
        <div class="empty-icon">📭</div>
        <p class="empty-title">No tools yet</p>
        <p class="empty-sub">Your MCP is live but doesn't expose anything yet. Open the builder, connect a source (database, REST API, documents, or website), and publish again.</p>
      </div>`
    : `
      ${
        toolsCount > 0
          ? `<div class="section">
        <h2>Tools <span class="count">${toolsCount}</span></h2>
        <p class="hint">Functions the AI can call (look up a record, search documents, etc.)</p>
        <ul class="items">
          ${tools
            .map(
              (t) => `<li>
            <code class="iname">${escapeHtml(t.name)}</code>
            <span class="idesc">${escapeHtml(t.description || "—")}</span>
          </li>`,
            )
            .join("")}
        </ul>
      </div>`
          : ""
      }
      ${
        resCount > 0
          ? `<div class="section">
        <h2>Resources <span class="count">${resCount}</span></h2>
        <p class="hint">Content the AI can read on demand (document collections, indexed pages)</p>
        <ul class="items">
          ${resources
            .map(
              (r) => `<li>
            <code class="iname">${escapeHtml(r.name)}</code>
            <span class="idesc">${escapeHtml(r.description || "—")}</span>
          </li>`,
            )
            .join("")}
        </ul>
      </div>`
          : ""
      }`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(name)} — MCP server</title>
<style>
  :root{--bg:#fafafa;--card:#fff;--ink:#0f172a;--ink-2:#475569;--ink-3:#94a3b8;--border:#e2e8f0;--accent:#0f766e;--accent-bg:#ccfbf1;--code-bg:#0b1220;--code-ink:#e2e8f0;}
  *{box-sizing:border-box}
  body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;max-width:760px;margin:0 auto;padding:48px 24px 80px;color:var(--ink);background:var(--bg);line-height:1.55}
  .pill{display:inline-flex;align-items:center;gap:6px;padding:3px 10px 3px 8px;border-radius:9999px;background:var(--accent-bg);color:var(--accent);font-size:12px;font-weight:600;margin-bottom:14px}
  .pill::before{content:"";width:6px;height:6px;border-radius:9999px;background:var(--accent);box-shadow:0 0 0 3px rgba(15,118,110,.18)}
  h1{font-size:28px;margin:0 0 6px;letter-spacing:-0.01em}
  .meta{color:var(--ink-2);font-size:13.5px;margin:0 0 6px}
  .desc{color:var(--ink-2);font-size:14px;margin:8px 0 0;max-width:62ch}

  .url-card{margin:24px 0 6px;border:1px solid var(--border);background:var(--card);border-radius:12px;padding:14px 16px}
  .url-card .label{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);font-weight:600}
  .url-row{display:flex;gap:8px;align-items:center;margin-top:6px}
  .url{flex:1;min-width:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:14px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:#f1f5f9;padding:8px 10px;border-radius:8px}
  .btn{appearance:none;border:1px solid var(--border);background:var(--card);padding:8px 12px;border-radius:8px;font-size:12.5px;cursor:pointer;font-weight:500;color:var(--ink);transition:all .15s}
  .btn:hover{background:#f1f5f9}.btn.done{background:#dcfce7;color:#166534;border-color:#bbf7d0}
  .url-hint{margin:8px 0 0;font-size:12.5px;color:var(--ink-2)}

  .section{margin:28px 0}
  .section h2{font-size:15px;margin:0 0 4px;display:flex;align-items:center;gap:8px}
  .count{font-size:12px;color:var(--ink-3);background:#f1f5f9;border-radius:9999px;padding:1px 8px;font-weight:600}
  .hint{margin:0 0 12px;color:var(--ink-2);font-size:13px}
  .items{list-style:none;padding:0;margin:0;border:1px solid var(--border);border-radius:10px;background:var(--card);overflow:hidden}
  .items li{padding:10px 14px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:2px}
  .items li:first-child{border-top:0}
  .iname{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;color:var(--accent);background:none;padding:0}
  .idesc{color:var(--ink-2);font-size:13px}

  .empty{border:1px dashed var(--border);background:var(--card);border-radius:12px;padding:28px 20px;text-align:center}
  .empty-icon{font-size:30px;line-height:1;margin-bottom:8px}
  .empty-title{margin:0 0 4px;font-weight:600;font-size:15px}
  .empty-sub{margin:0 auto;color:var(--ink-2);font-size:13px;max-width:46ch}

  .connect{margin:32px 0 0}
  .connect h2{font-size:15px;margin:0 0 4px}
  .tabs{display:flex;gap:4px;margin:14px 0 10px;border-bottom:1px solid var(--border)}
  .tab{appearance:none;border:0;background:none;padding:8px 12px;font-size:13px;cursor:pointer;color:var(--ink-2);border-bottom:2px solid transparent;font-weight:500;margin-bottom:-1px}
  .tab[aria-selected="true"]{color:var(--ink);border-bottom-color:var(--ink)}
  .panel{display:none}.panel[data-active="true"]{display:block}
  .panel p{margin:0 0 10px;color:var(--ink-2);font-size:13px}
  .panel ol{margin:0 0 10px 22px;padding:0;color:var(--ink-2);font-size:13px}
  .panel ol li{margin:2px 0}
  pre{position:relative;background:var(--code-bg);color:var(--code-ink);padding:14px 16px;border-radius:10px;overflow:auto;font-size:12.5px;line-height:1.55;margin:0}
  .code-wrap{position:relative;margin:6px 0 0}
  .copy{position:absolute;top:8px;right:8px;background:rgba(255,255,255,.08);color:#e2e8f0;border:1px solid rgba(255,255,255,.15);padding:4px 10px;border-radius:6px;font-size:11.5px;cursor:pointer}
  .copy:hover{background:rgba(255,255,255,.16)}
  .copy.done{background:#10b981;border-color:#10b981;color:#fff}
  details{margin-top:24px}
  summary{cursor:pointer;color:var(--ink-2);font-size:13px;list-style:none;padding:6px 0}
  summary::before{content:"▸ ";color:var(--ink-3)}
  details[open] summary::before{content:"▾ "}
  .small{font-size:12px;color:var(--ink-3)}
  code{background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:12.5px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
</style></head><body>
<span class="pill">live</span>
<h1>${escapeHtml(name)}</h1>
<p class="meta">${agency ? escapeHtml(agency) + " · " : ""}${toolsCount} tool${toolsCount === 1 ? "" : "s"} · ${resCount} resource${resCount === 1 ? "" : "s"} · slug <code>${escapeHtml(slug)}</code></p>
${description ? `<p class="desc">${escapeHtml(description)}</p>` : ""}

<div class="url-card">
  <div class="label">MCP server URL</div>
  <div class="url-row">
    <span class="url" id="server-url">${escapeHtml(url)}</span>
    <button class="btn" data-copy="server-url-raw">Copy</button>
    <span id="server-url-raw" style="display:none">${escapeHtml(url)}</span>
  </div>
  <p class="url-hint">Paste this address into Claude Desktop, Cursor, or any MCP-compatible AI client. Setup steps are below.</p>
</div>

${toolsListHtml}

<div class="connect">
  <h2>Connect this to your AI</h2>
  <div class="tabs" role="tablist">
    <button class="tab" role="tab" aria-selected="true" data-panel="claude">Claude Desktop</button>
    <button class="tab" role="tab" aria-selected="false" data-panel="cursor">Cursor</button>
    <button class="tab" role="tab" aria-selected="false" data-panel="other">Other / custom</button>
  </div>

  <div class="panel" data-key="claude" data-active="true">
    <ol>
      <li>Open Claude Desktop, then <strong>Settings → Developer → Edit Config</strong>.</li>
      <li>Paste the snippet below into <code>claude_desktop_config.json</code> (merge with any existing <code>mcpServers</code>).</li>
      <li>Quit and reopen Claude Desktop. Your tools will appear under the 🔌 icon.</li>
    </ol>
    <div class="code-wrap">
      <pre id="cfg-claude">${escapeHtml(claudeConfig)}</pre>
      <button class="copy" data-copy="cfg-claude">Copy</button>
    </div>
    <p class="small" style="margin-top:8px">Uses <code>mcp-remote</code> to bridge Claude's stdio transport to this HTTP server. <code>npx</code> downloads it on first run.</p>
  </div>

  <div class="panel" data-key="cursor" data-active="false">
    <ol>
      <li>Open Cursor's settings, find <strong>MCP Servers</strong> (or edit <code>~/.cursor/mcp.json</code>).</li>
      <li>Add the snippet below.</li>
      <li>Restart Cursor.</li>
    </ol>
    <div class="code-wrap">
      <pre id="cfg-cursor">${escapeHtml(cursorConfig)}</pre>
      <button class="copy" data-copy="cfg-cursor">Copy</button>
    </div>
  </div>

  <div class="panel" data-key="other" data-active="false">
    <p>Any client that speaks the MCP HTTP transport works. Point it at the URL above. The server uses JSON-RPC 2.0 and supports <code>initialize</code>, <code>tools/list</code>, <code>tools/call</code>, <code>resources/list</code>, <code>resources/read</code>, and <code>ping</code>.</p>
    <p>Quick sanity check from a terminal:</p>
    <div class="code-wrap">
      <pre id="cfg-curl">${escapeHtml(curlCmd)}</pre>
      <button class="copy" data-copy="cfg-curl">Copy</button>
    </div>
  </div>
</div>

<details>
  <summary>What is this URL, exactly?</summary>
  <p class="small" style="margin:6px 0 0;line-height:1.6">It's an MCP (Model Context Protocol) server. AI clients connect over JSON-RPC 2.0 and ask it for tools and resources. When the AI calls a tool, this server runs it against your connected database / REST API / documents and returns the result. Nothing here is publicly browsable — the page you're looking at is just a status check.</p>
</details>

<script>
  // Copy buttons
  document.querySelectorAll('[data-copy]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var id = btn.getAttribute('data-copy');
      var el = document.getElementById(id);
      if (!el) return;
      var text = el.textContent || '';
      navigator.clipboard.writeText(text).then(function(){
        var original = btn.textContent;
        btn.textContent = 'Copied!';
        btn.classList.add('done');
        setTimeout(function(){ btn.textContent = original; btn.classList.remove('done'); }, 1400);
      });
    });
  });
  // Tabs
  document.querySelectorAll('.tab').forEach(function(tab){
    tab.addEventListener('click', function(){
      var key = tab.getAttribute('data-panel');
      document.querySelectorAll('.tab').forEach(function(t){ t.setAttribute('aria-selected', t === tab ? 'true' : 'false'); });
      document.querySelectorAll('.panel').forEach(function(p){ p.setAttribute('data-active', p.getAttribute('data-key') === key ? 'true' : 'false'); });
    });
  });
</script>
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
