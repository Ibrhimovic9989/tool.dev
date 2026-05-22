// Server-side runtime: given a published project, list its tools/resources
// and execute them on demand. Used by:
//   - /api/mcp/[slug]/route.ts  — the real MCP HTTP transport
//
// Reuses the same I/O strategies as the generated code: HTTP fetch for REST,
// pg for Postgres, HTTP fetch for Web pages, declarative-only for Documents.

import "server-only";
import type {
  McpProject,
  RestEndpoint,
  RestSourceData,
  DatabaseSourceData,
  WebpageSourceData,
  DocumentsSourceData,
  McpNode,
} from "@/lib/types";
import { withPgClient, fromDbSource } from "@/lib/db/pg-client";
import { embedOne } from "@/lib/docs/embed";
import { searchVectors } from "@/lib/docs/store";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

export interface ResourceDef {
  name: string;
  uri: string;
  description: string;
  mimeType: string;
}

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface ResourceContents {
  contents: { uri: string; mimeType: string; text: string }[];
}

/** All tools the project exposes (across every connected source node). */
export function listTools(project: McpProject): ToolDef[] {
  const sources = connectedSources(project);
  const out: ToolDef[] = [];
  for (const node of sources) {
    if (node.data.kind === "source.rest") {
      for (const ep of node.data.endpoints.filter(
        (e) => e.enabled && e.toolName,
      )) {
        out.push(restToToolDef(ep));
      }
    } else if (node.data.kind === "source.database") {
      for (const t of node.data.tables.filter(
        (x) => x.enabled && x.toolName && x.name,
      )) {
        out.push({
          name: t.toolName,
          description:
            t.description || `Read rows from ${t.schema}.${t.name}`,
          inputSchema: { type: "object", properties: {}, required: [] },
        });
      }
    } else if (node.data.kind === "source.documents") {
      for (const c of node.data.collections.filter(
        (x) => x.enabled && x.resourceName,
      )) {
        const safe = sanitizeToolName(c.resourceName);
        out.push({
          name: `search_${safe}`,
          description:
            (c.description ? c.description + " " : "") +
            `Semantic search across documents in '${c.resourceName}'. Returns the most relevant passages.`,
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Natural-language query" },
              topK: { type: "number", description: "How many passages (default 5)" },
            },
            required: ["query"],
          },
        });
        out.push({
          name: `find_similar_${safe}`,
          description: `Given a passage, finds near-duplicate or similar content in '${c.resourceName}'. Useful for detecting redundant documents.`,
          inputSchema: {
            type: "object",
            properties: {
              text: { type: "string", description: "Passage to compare against the corpus" },
              minScore: {
                type: "number",
                description: "Cosine threshold 0-1 (default 0.78)",
              },
              topK: { type: "number", description: "Max matches (default 10)" },
            },
            required: ["text"],
          },
        });
      }
    } else if (node.data.kind === "source.webpage") {
      for (const t of node.data.targets.filter((x) => x.enabled && x.url)) {
        const safe = sanitizeToolName(t.resourceName || t.id);
        out.push({
          name: `fetch_${safe}`,
          description:
            t.description ||
            `Fetch the current content of ${t.url} as plain text.`,
          inputSchema: { type: "object", properties: {}, required: [] },
        });
      }
    }
  }
  // Cross-source tool-name dedup. Two sources (e.g. a Documents collection
  // and a REST endpoint) could sanitize to the same name; without dedup
  // the MCP client sees duplicates and tools/call picks the first match
  // unpredictably. Keep first-wins and log the collision.
  const seen = new Set<string>();
  const deduped: ToolDef[] = [];
  for (const t of out) {
    if (seen.has(t.name)) continue;
    seen.add(t.name);
    deduped.push(t);
  }
  return deduped;
}

function sanitizeToolName(s: string): string {
  return s.replace(/[^a-z0-9_]/gi, "_").toLowerCase().slice(0, 40);
}

export function listResources(project: McpProject): ResourceDef[] {
  const sources = connectedSources(project);
  const out: ResourceDef[] = [];
  for (const node of sources) {
    if (node.data.kind === "source.documents") {
      for (const c of node.data.collections.filter(
        (x) => x.enabled && x.resourceName,
      )) {
        out.push({
          name: c.resourceName,
          uri: `docs://${c.resourceName}`,
          description: c.description,
          mimeType: "text/plain",
        });
      }
    } else if (node.data.kind === "source.webpage") {
      for (const t of node.data.targets.filter((x) => x.enabled && x.url)) {
        const name = t.resourceName || t.id;
        out.push({
          name,
          uri: `web://${name}`,
          description: t.description,
          mimeType: "text/html",
        });
      }
    }
  }
  return out;
}

export async function callTool(
  project: McpProject,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  for (const node of connectedSources(project)) {
    if (node.data.kind === "source.rest") {
      const ep = node.data.endpoints.find(
        (e) => e.enabled && e.toolName === name,
      );
      if (ep) return callRest(node.data, ep, args, project.secrets);
    } else if (node.data.kind === "source.database") {
      const t = node.data.tables.find(
        (x) => x.enabled && x.toolName === name,
      );
      if (t) return callDb(node.data, t, project.secrets);
    } else if (node.data.kind === "source.documents") {
      for (const c of node.data.collections) {
        if (!c.enabled || !c.resourceName) continue;
        const safe = sanitizeToolName(c.resourceName);
        if (name === `search_${safe}`) {
          return callSearchDocs(project.id, c.id, args);
        }
        if (name === `find_similar_${safe}`) {
          return callFindSimilar(project.id, c.id, args);
        }
      }
    } else if (node.data.kind === "source.webpage") {
      for (const t of node.data.targets) {
        if (!t.enabled || !t.url) continue;
        const safe = sanitizeToolName(t.resourceName || t.id);
        if (name === `fetch_${safe}`) {
          return callFetchWebpage(t.url);
        }
      }
    }
  }
  return errorResult(`Unknown tool: ${name}`);
}

async function callFetchWebpage(url: string): Promise<ToolResult> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "makemcp.dev/0.1" },
    });
    if (!res.ok) {
      return errorResult(`Fetch failed: HTTP ${res.status}`);
    }
    const text = await res.text();
    // MCP clients consume tool output as text; ~256 KB cap is enough for
    // most HTML pages and well under context limits.
    const capped = text.length > 256_000 ? text.slice(0, 256_000) + "\n…[truncated]" : text;
    return { content: [{ type: "text", text: capped }] };
  } catch (e) {
    return errorResult(
      `Fetch error: ${e instanceof Error ? e.message : "unknown"}`,
    );
  }
}

export async function readResource(
  project: McpProject,
  uri: string,
): Promise<ResourceContents> {
  for (const node of connectedSources(project)) {
    if (node.data.kind === "source.documents") {
      for (const c of node.data.collections) {
        if (`docs://${c.resourceName}` === uri) {
          const text = c.files.length
            ? `Files: ${c.files.map((f) => f.name).join(", ")}`
            : c.sourceLocation
              ? `Source: ${c.sourceLocation}`
              : "No content yet.";
          return {
            contents: [{ uri, mimeType: "text/plain", text }],
          };
        }
      }
    } else if (node.data.kind === "source.webpage") {
      for (const t of node.data.targets) {
        const name = t.resourceName || t.id;
        if (`web://${name}` === uri) {
          const res = await fetch(t.url);
          const text = await res.text();
          return { contents: [{ uri, mimeType: "text/html", text }] };
        }
      }
    }
  }
  throw new Error(`Unknown resource: ${uri}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// internals
// ─────────────────────────────────────────────────────────────────────────────

function connectedSources(project: McpProject): McpNode[] {
  const output = project.nodes.find((n) => n.data.kind === "output.mcp");
  const connectedIds = new Set(
    output
      ? project.edges.filter((e) => e.target === output.id).map((e) => e.source)
      : project.nodes
          .filter((n) => n.data.kind !== "output.mcp")
          .map((n) => n.id),
  );
  return project.nodes.filter((n) => connectedIds.has(n.id));
}

function restToToolDef(ep: RestEndpoint): ToolDef {
  return {
    name: ep.toolName,
    description: ep.description || `${ep.method} ${ep.path}`,
    inputSchema: {
      type: "object",
      properties: Object.fromEntries(
        ep.parameters.map((p) => [
          p.name,
          { type: p.type, description: p.description },
        ]),
      ),
      required: ep.parameters.filter((p) => p.required).map((p) => p.name),
    },
  };
}

async function callRest(
  data: RestSourceData,
  ep: RestEndpoint,
  args: Record<string, unknown>,
  secrets: Record<string, string>,
): Promise<ToolResult> {
  if (!data.baseUrl) return errorResult("REST source has no base URL");
  let url = data.baseUrl.replace(/\/$/, "") + ep.path;
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(args ?? {})) {
    if (v === undefined || v === null) continue;
    const s = String(v);
    if (url.includes(`:${k}`)) url = url.replace(`:${k}`, encodeURIComponent(s));
    else if (url.includes(`{${k}}`))
      url = url.replace(`{${k}}`, encodeURIComponent(s));
    else query.set(k, s);
  }
  const qs = query.toString();
  if (qs) url += (url.includes("?") ? "&" : "?") + qs;

  const headers: Record<string, string> = {};
  if (data.auth.kind === "apiKey" && data.auth.keyName) {
    headers[data.auth.keyName] = secrets[data.auth.secretEnvVar ?? ""] ?? "";
  } else if (data.auth.kind === "bearer") {
    headers["Authorization"] =
      "Bearer " + (secrets[data.auth.secretEnvVar ?? ""] ?? "");
  } else if (data.auth.kind === "basic") {
    const user = data.auth.keyName ?? "";
    const pwd = secrets[data.auth.secretEnvVar ?? ""] ?? "";
    headers["Authorization"] =
      "Basic " + Buffer.from(`${user}:${pwd}`).toString("base64");
  }

  try {
    const res = await fetch(url, { method: ep.method, headers });
    const text = await res.text();
    return {
      content: [{ type: "text", text: `[${res.status}] ${text}` }],
      isError: !res.ok,
    };
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : "fetch failed");
  }
}

async function callDb(
  data: DatabaseSourceData,
  table: { schema: string; name: string; rowFilter?: string },
  secrets: Record<string, string>,
): Promise<ToolResult> {
  if (data.engine !== "postgres") {
    return errorResult(
      "Hosted runtime supports Postgres only; MySQL/SQL Server requires the downloaded server.",
    );
  }
  const password = secrets[data.passwordEnvVar];
  if (!password) {
    return errorResult(
      `Missing DB password — set ${data.passwordEnvVar} (in the builder's Saved secrets) before publishing.`,
    );
  }
  const where = table.rowFilter ? ` WHERE ${table.rowFilter}` : "";
  const sql = `SELECT * FROM "${table.schema}"."${table.name}"${where} LIMIT 100`;
  try {
    const rows = await withPgClient(fromDbSource(data, password), (q) =>
      q<Record<string, unknown>>(sql),
    );
    return {
      content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
    };
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : "DB query failed");
  }
}

async function callSearchDocs(
  projectId: string,
  collectionId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const query = String(args.query ?? "").trim();
  if (!query) return errorResult("Missing query");
  const topK = Math.min(20, Math.max(1, Number(args.topK ?? 5) || 5));
  try {
    const vec = await embedOne(query);
    const hits = await searchVectors(projectId, collectionId, vec, topK);
    if (hits.length === 0) {
      return {
        content: [
          { type: "text", text: "No matching passages found in this collection." },
        ],
      };
    }
    const formatted = hits
      .map(
        (h, i) =>
          `[${i + 1}] score=${h.score.toFixed(3)}  ${h.chunk.fileName}\n${h.chunk.text}`,
      )
      .join("\n\n---\n\n");
    return { content: [{ type: "text", text: formatted }] };
  } catch (e) {
    return errorResult(
      e instanceof Error ? e.message : "Search failed",
    );
  }
}

async function callFindSimilar(
  projectId: string,
  collectionId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const text = String(args.text ?? "").trim();
  if (!text) return errorResult("Missing text");
  const minScore = Math.min(1, Math.max(0, Number(args.minScore ?? 0.78) || 0.78));
  const topK = Math.min(50, Math.max(1, Number(args.topK ?? 10) || 10));
  try {
    const vec = await embedOne(text);
    const hits = await searchVectors(projectId, collectionId, vec, topK, minScore);
    if (hits.length === 0) {
      return {
        content: [
          { type: "text", text: `No similar passages above ${minScore.toFixed(2)}.` },
        ],
      };
    }
    // Group by source file so the dedup story is obvious.
    const grouped: Record<string, { score: number; text: string }[]> = {};
    for (const h of hits) {
      (grouped[h.chunk.fileName] ??= []).push({ score: h.score, text: h.chunk.text });
    }
    const lines: string[] = [];
    for (const [file, items] of Object.entries(grouped)) {
      const best = Math.max(...items.map((i) => i.score));
      lines.push(`• ${file}  (best score ${best.toFixed(3)}, ${items.length} matching passage${items.length === 1 ? "" : "s"})`);
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : "Similarity search failed");
  }
}

function errorResult(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }], isError: true };
}

// touched to avoid unused-import warnings for nodes we use only in routing logic
type _unused = WebpageSourceData | DocumentsSourceData;
