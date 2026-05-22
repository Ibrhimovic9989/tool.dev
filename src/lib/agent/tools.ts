// Agent tools — the verbs the LLM can call to build a user's MCP. Each tool
// has (1) an OpenAI-compatible JSON schema the model sees and (2) a
// server-side handler that mutates the project owned by the calling user.
//
// Handlers always re-fetch the project on entry so they're safe to call in
// any order — no shared state between calls.

import "server-only";
import { nanoid } from "nanoid";
import { createNode } from "@/lib/factory";
import { parsePostgresUrl } from "@/lib/db/connection-string";
import { isPlausiblePasswordEnvVar } from "@/lib/ai/extract-secrets";
import { withPgClient, fromDbSource } from "@/lib/db/pg-client";
import {
  addNodeToProject,
  createProject as svcCreateProject,
  getProject,
  setProjectSecret,
  updateProjectGraph,
} from "@/lib/server/projects-service";
import { savePublishedProject } from "@/lib/server/project-store";
import { listTools as runtimeListTools } from "@/lib/server/mcp-runtime";
import { listIndexedFiles } from "@/lib/docs/store";
import type {
  DatabaseSourceData,
  DbTable,
  DocumentsSourceData,
  McpProject,
  RestSourceData,
} from "@/lib/types";

export interface ToolContext {
  userId: string;
  /** The agent's "current project" — set after create_project is called. */
  currentProjectId: string | null;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolHandlerResult {
  /** Free-text summary the model sees as the tool's response */
  message: string;
  /** Optional structured data, also sent to the model */
  data?: Record<string, unknown>;
  /** If the project ID changed (e.g. create_project ran), update the context. */
  newCurrentProjectId?: string;
  /** True if the project state changed — the client should refresh */
  projectUpdated?: boolean;
  /** Make `isError` available so the model can adjust */
  isError?: boolean;
}

// ─── Tool catalog (model-facing schemas) ────────────────────────────────────

export const TOOLS: ToolDef[] = [
  {
    name: "create_project",
    description:
      "Start a new MCP project for the user. Only call when there is NO active project. If one exists, this tool will refuse — modify the existing project instead.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Friendly name, e.g. 'Health Records MCP'" },
        description: { type: "string", description: "1-2 sentence purpose" },
        agency: { type: "string", description: "Agency or department" },
      },
      required: ["name"],
    },
  },
  {
    name: "add_source",
    description:
      "Attach a data source to the current project. For databases, also auto-discovers tables and registers each as a tool — no separate discovery call needed. Reuses an existing source of the same kind when present (e.g. a Documents source created by chat uploads).",
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["database", "rest", "documents", "webpage"],
          description:
            "What kind of source to attach. 'database' for Postgres connection strings; 'rest' for HTTP APIs; 'documents' for PDF/Word/text files; 'webpage' for fetching a single public URL on demand.",
        },
        name: {
          type: "string",
          description: "Friendly name for this source (optional).",
        },
        url: {
          type: "string",
          description: "kind='webpage' only. The single public URL to fetch.",
        },
        resourceName: {
          type: "string",
          description:
            "kind='documents' or 'webpage' only. snake_case identifier (e.g. 'hn_frontpage' for a webpage, 'policies' for a documents collection).",
        },
        // database
        connectionString: {
          type: "string",
          description:
            "kind='database' only. Full postgres:// or postgresql:// URL with credentials.",
        },
        // rest
        baseUrl: {
          type: "string",
          description: "kind='rest' only. https://api.example.com",
        },
        authKind: {
          type: "string",
          enum: ["none", "apiKey", "bearer", "basic"],
          description: "kind='rest' only.",
        },
        authHeaderName: {
          type: "string",
          description: "kind='rest' with apiKey only, e.g. 'X-API-Key'.",
        },
        authEnvVar: {
          type: "string",
          description:
            "kind='rest' only. Env var name where the token lives, e.g. 'API_TOKEN'.",
        },
      },
      required: ["kind"],
    },
  },
  {
    name: "discover_database_tables",
    description:
      "Re-run table discovery on the project's existing database source. Use only if the schema changed since the database was first added; add_source already discovers on attach.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "add_rest_endpoint",
    description:
      "Define a REST endpoint as an MCP tool on a REST source. Required follow-up after add_source(kind='rest'). If the user pasted a full URL like 'https://api.example.com/foo?lat=1&lng=2', parse it: path under base URL, query params become tool parameters; fold fixed values like 'format=json' directly into the path. When the project has MULTIPLE REST sources, you MUST pass sourceName to target the right one — otherwise the endpoint lands on the wrong source. If toolName already exists on a different REST source, this tool moves it to the target source.",
    parameters: {
      type: "object",
      properties: {
        toolName: {
          type: "string",
          description:
            "snake_case identifier the AI client will call, e.g. 'get_hourly_temperature'",
        },
        sourceName: {
          type: "string",
          description:
            "REST source name to attach this endpoint to. REQUIRED when more than one REST source exists. Case-insensitive substring match against the source's name.",
        },
        description: {
          type: "string",
          description:
            "1-sentence plain-English description of what this endpoint does",
        },
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "DELETE", "PATCH"],
        },
        path: {
          type: "string",
          description:
            "Path under the source's base URL, e.g. '/forecast'. May include fixed query params like '/forecast?hourly=temperature_2m'.",
        },
        parameters: {
          type: "array",
          description:
            "Parameters the AI client will supply when calling this tool. Omit fixed values that you've already embedded in the path.",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              type: {
                type: "string",
                enum: ["string", "integer", "number", "boolean"],
              },
              required: { type: "boolean" },
              description: { type: "string" },
            },
            required: ["name", "type"],
          },
        },
      },
      required: ["toolName", "method", "path"],
    },
  },
  {
    name: "check_project_health",
    description:
      "Inspect the current project and report sources, exposed tool count, and any blockers. Optional — publish_project enforces the same check server-side regardless.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "publish_project",
    description:
      "Persist the current project to the live MCP runtime. Runs the full health check server-side and refuses if any blocker would result in a useless MCP — you don't have to call check_project_health first.",
    parameters: { type: "object", properties: {} },
  },
];

// ─── Dispatcher ─────────────────────────────────────────────────────────────

export async function runTool(
  ctx: ToolContext,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  try {
    switch (name) {
      case "create_project":
        return await toolCreateProject(ctx, args);
      case "add_source":
        return await toolAddSource(ctx, args);
      // Backwards-compat: old conversation history may replay these names.
      // Route them to add_source so we don't lose continuity, but the model
      // only sees `add_source` in its current tool catalog.
      case "add_database_source":
        return await toolAddSource(ctx, { kind: "database", ...args });
      case "add_rest_source":
        return await toolAddSource(ctx, { kind: "rest", ...args });
      case "add_documents_source":
        return await toolAddSource(ctx, { kind: "documents", ...args });
      case "discover_database_tables":
        return await toolDiscoverDatabaseTables(ctx);
      case "add_rest_endpoint":
        return await toolAddRestEndpoint(ctx, args);
      case "check_project_health":
        return await toolCheckProjectHealth(ctx);
      case "publish_project":
        return await toolPublishProject(ctx);
      default:
        return { message: `Unknown tool: ${name}`, isError: true };
    }
  } catch (e) {
    return {
      message: `Tool ${name} failed: ${e instanceof Error ? e.message : String(e)}`,
      isError: true,
    };
  }
}

// ─── Handlers ───────────────────────────────────────────────────────────────

async function toolCreateProject(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  // Goldilocks-altitude rule from prose moved into code (Anthropic's
  // "Effective context engineering" + Karpathy's "don't make the model
  // follow rules in English when the substrate can refuse"). Spawning
  // duplicate projects was our worst recurring failure mode.
  if (ctx.currentProjectId) {
    return {
      message: `An active project already exists (id=${ctx.currentProjectId}). Modify it via add_source instead of creating a new one.`,
      isError: true,
    };
  }
  const name = String(args.name ?? "Untitled MCP");
  const description = String(args.description ?? "");
  const agency = String(args.agency ?? "");
  const project = await svcCreateProject(
    { userId: ctx.userId },
    name,
    description,
    agency,
  );
  return {
    message: `Created project '${name}' (id=${project.id}). It currently has only an MCP Server output node; add at least one source next.`,
    data: { projectId: project.id, slug: outputSlug(project) },
    newCurrentProjectId: project.id,
    projectUpdated: true,
  };
}

/**
 * Single source-attach verb. Dispatches on `kind` and absorbs the three
 * former add_*_source handlers + auto-discovery for the database kind.
 *
 * This is the v0 / Codex pattern (one well-described tool beats three
 * near-duplicates) — the model used to mix up which add_* to call when
 * the user's message was ambiguous; now it just passes `kind`.
 */
async function toolAddSource(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  if (!ctx.currentProjectId) {
    return { message: "Call create_project first.", isError: true };
  }
  const kind = String(args.kind ?? "");
  switch (kind) {
    case "database":
      return toolAddDatabaseSource(ctx, args);
    case "rest":
      return toolAddRestSource(ctx, args);
    case "documents":
      return toolAddDocumentsSource(ctx, args);
    case "webpage":
      return toolAddWebpageSource(ctx, args);
    default:
      return {
        message: `Unknown source kind '${kind}'. Use 'database', 'rest', 'documents', or 'webpage'.`,
        isError: true,
      };
  }
}

async function toolAddWebpageSource(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  if (!ctx.currentProjectId) {
    return { message: "Call create_project first.", isError: true };
  }
  const url = String(args.url ?? "").trim();
  if (!/^https?:\/\//i.test(url)) {
    return {
      message: "kind='webpage' requires a url field (http or https).",
      isError: true,
    };
  }
  const resourceName = String(
    args.resourceName ?? deriveResourceNameFromUrl(url),
  )
    .replace(/[^a-z0-9_]/gi, "_")
    .toLowerCase()
    .slice(0, 40) || "page";

  const node = createNode("source.webpage", { x: 80, y: 80 });
  // Cast to satisfy TS — the factory creates the right discriminated shape.
  const data = node.data as { kind: "source.webpage"; name: string; status: "draft" | "ready" | "error"; targets: import("@/lib/types").WebTarget[]; refreshHours: number };
  data.name = String(args.name ?? "Website");
  data.refreshHours = 24;
  data.targets = [
    {
      id: nanoid(8),
      url,
      resourceName,
      description: `Content fetched from ${url}`,
      followLinks: false,
      maxDepth: 1,
      enabled: true,
    },
  ];
  data.status = "ready";
  await addNodeToProject({ userId: ctx.userId }, ctx.currentProjectId, node);
  return {
    message: `Attached webpage '${data.name}' fetching ${url}. Exposed as MCP tool 'fetch_${resourceName}'.`,
    data: { url, resourceName, toolName: `fetch_${resourceName}` },
    projectUpdated: true,
  };
}

function deriveResourceNameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    return host + (u.pathname && u.pathname !== "/" ? u.pathname : "");
  } catch {
    return "page";
  }
}

async function toolAddDatabaseSource(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  if (!ctx.currentProjectId) {
    return { message: "Call create_project first.", isError: true };
  }
  const connStr = String(args.connectionString ?? "");
  const parsed = parsePostgresUrl(connStr);
  if (!parsed) {
    return {
      message:
        "Couldn't parse connection string — expected a postgres:// or postgresql:// URL.",
      isError: true,
    };
  }
  const node = createNode("source.database", { x: 80, y: 80 });
  const data = node.data as DatabaseSourceData & { kind: "source.database" };
  data.name = String(args.name ?? "Database");
  data.engine = "postgres";
  data.host = parsed.host;
  data.port = parsed.port;
  data.database = parsed.database;
  data.username = parsed.username;
  data.ssl = parsed.ssl;
  data.passwordEnvVar = isPlausiblePasswordEnvVar(data.passwordEnvVar)
    ? data.passwordEnvVar
    : "DB_PASSWORD";

  await addNodeToProject({ userId: ctx.userId }, ctx.currentProjectId, node);
  if (parsed.password) {
    await setProjectSecret(
      { userId: ctx.userId },
      ctx.currentProjectId,
      data.passwordEnvVar,
      parsed.password,
    );
  }

  // Auto-discover tables. Database attach + discover were always called
  // back-to-back; Anthropic's "consolidate frequently chained tools"
  // pattern says merge them. Failure here is non-fatal — attach still
  // succeeds; the model can call discover_database_tables manually later
  // if e.g. the password is wrong and they want to retry.
  let discoveryNote = "";
  try {
    const discoveryResult = await toolDiscoverDatabaseTables(ctx);
    if (!discoveryResult.isError) {
      const tableCount =
        (discoveryResult.data?.tables as { name: string }[] | undefined)
          ?.length ?? 0;
      discoveryNote = ` Discovered ${tableCount} table(s) and registered each as an MCP tool.`;
    } else {
      discoveryNote = ` (Couldn't auto-discover tables: ${discoveryResult.message})`;
    }
  } catch (e) {
    discoveryNote = ` (Auto-discovery skipped: ${e instanceof Error ? e.message : "unknown error"})`;
  }

  return {
    message: `Attached database '${data.name}' at ${data.host}:${data.port}/${data.database} as user '${data.username}'.${discoveryNote}`,
    data: { host: data.host, database: data.database },
    projectUpdated: true,
  };
}

async function toolDiscoverDatabaseTables(
  ctx: ToolContext,
): Promise<ToolHandlerResult> {
  if (!ctx.currentProjectId) {
    return { message: "No current project.", isError: true };
  }
  const project = await getProject({ userId: ctx.userId }, ctx.currentProjectId);
  if (!project) return { message: "Project not found.", isError: true };
  const dbNode = project.nodes.find((n) => n.data.kind === "source.database");
  if (!dbNode || dbNode.data.kind !== "source.database") {
    return {
      message: "No database source on this project yet; call add_database_source first.",
      isError: true,
    };
  }
  const password = project.secrets[dbNode.data.passwordEnvVar];
  if (!password) {
    return {
      message: `Missing password in secrets[${dbNode.data.passwordEnvVar}].`,
      isError: true,
    };
  }
  const rows = await withPgClient(fromDbSource(dbNode.data, password), (q) =>
    q<{ schema: string; name: string; row_estimate: number }>(
      `
      SELECT n.nspname AS schema, c.relname AS name, c.reltuples::bigint AS row_estimate
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r','v','m','p') AND n.nspname = 'public'
      ORDER BY n.nspname, c.relname
      `,
    ),
  );
  const tables: DbTable[] = rows.map((t) => ({
    id: nanoid(8),
    schema: t.schema,
    name: t.name,
    toolName: `list_${t.name}`
      .replace(/[^a-z0-9_]/gi, "_")
      .toLowerCase()
      .slice(0, 60),
    description: `Read rows from ${t.schema}.${t.name}${t.row_estimate ? ` (~${t.row_estimate} rows)` : ""}`,
    readOnly: true,
    enabled: true,
  }));
  const dbNodeId = dbNode.id;
  await updateProjectGraph({ userId: ctx.userId }, ctx.currentProjectId, (p) => {
    const node = p.nodes.find((n) => n.id === dbNodeId);
    if (!node || node.data.kind !== "source.database") return;
    const existing = new Set(node.data.tables.map((t) => `${t.schema}.${t.name}`));
    const fresh = tables.filter((t) => !existing.has(`${t.schema}.${t.name}`));
    node.data.tables = [...node.data.tables, ...fresh];
    node.data.status = node.data.tables.some((t) => t.enabled) ? "ready" : "draft";
  });
  return {
    message: `Discovered ${tables.length} table(s) and registered each as an MCP tool (read-only).`,
    data: { tables: tables.map((t) => ({ name: t.name, toolName: t.toolName })) },
    projectUpdated: true,
  };
}

async function toolAddRestSource(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  if (!ctx.currentProjectId) {
    return { message: "Call create_project first.", isError: true };
  }
  const baseUrl = String(args.baseUrl ?? "");
  if (!/^https?:\/\//i.test(baseUrl)) {
    return { message: "baseUrl must be an http(s) URL.", isError: true };
  }
  const node = createNode("source.rest", { x: 80, y: 80 });
  const data = node.data as RestSourceData & { kind: "source.rest" };
  data.name = String(args.name ?? "REST API");
  data.baseUrl = baseUrl;
  const authKind = (args.authKind as RestSourceData["auth"]["kind"]) ?? "none";
  data.auth = {
    kind: authKind,
    keyName: args.authHeaderName ? String(args.authHeaderName) : undefined,
    secretEnvVar: args.authEnvVar ? String(args.authEnvVar) : undefined,
  };
  await addNodeToProject({ userId: ctx.userId }, ctx.currentProjectId, node);
  return {
    message: `Attached REST API '${data.name}' at ${baseUrl}. Auth: ${authKind}. NEXT: call add_rest_endpoint to define at least one endpoint — until you do, the REST source is in draft and publish will refuse.`,
    data: { baseUrl },
    projectUpdated: true,
  };
}

async function toolAddRestEndpoint(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  if (!ctx.currentProjectId) {
    return { message: "Call create_project first.", isError: true };
  }
  const project = await getProject(
    { userId: ctx.userId },
    ctx.currentProjectId,
  );
  if (!project) return { message: "Project not found.", isError: true };

  // Find all REST sources. With more than one, sourceName is required so
  // we don't pick wrong. Without sourceName + single source: use it.
  const restNodes = project.nodes.filter(
    (n): n is typeof n & { data: { kind: "source.rest" } } =>
      n.data.kind === "source.rest",
  );
  if (restNodes.length === 0) {
    return {
      message:
        "No REST source on this project yet — call add_source({kind:'rest', baseUrl}) first.",
      isError: true,
    };
  }
  const sourceNameArg =
    typeof args.sourceName === "string" ? args.sourceName.toLowerCase() : null;
  let restNode: (typeof restNodes)[number];
  if (restNodes.length > 1) {
    if (!sourceNameArg) {
      return {
        message: `Multiple REST sources exist (${restNodes.map((n) => `"${n.data.name}"`).join(", ")}). Pass sourceName to disambiguate.`,
        isError: true,
      };
    }
    const matches = restNodes.filter((n) =>
      n.data.name.toLowerCase().includes(sourceNameArg),
    );
    if (matches.length === 0) {
      return {
        message: `No REST source matches sourceName='${args.sourceName}'. Available: ${restNodes.map((n) => `"${n.data.name}"`).join(", ")}.`,
        isError: true,
      };
    }
    if (matches.length > 1) {
      return {
        message: `Ambiguous sourceName='${args.sourceName}' — matches ${matches.length} sources: ${matches.map((n) => `"${n.data.name}"`).join(", ")}. Be more specific.`,
        isError: true,
      };
    }
    restNode = matches[0];
  } else {
    restNode = restNodes[0];
  }

  const toolName = String(args.toolName ?? "")
    .replace(/[^a-z0-9_]/gi, "_")
    .toLowerCase()
    .slice(0, 60);
  if (!toolName) {
    return { message: "toolName is required.", isError: true };
  }
  const method = String(args.method ?? "GET").toUpperCase() as
    | "GET"
    | "POST"
    | "PUT"
    | "DELETE"
    | "PATCH";
  if (!["GET", "POST", "PUT", "DELETE", "PATCH"].includes(method)) {
    return {
      message: `Invalid method '${method}'. Use GET, POST, PUT, DELETE, or PATCH.`,
      isError: true,
    };
  }
  const path = String(args.path ?? "");
  if (!path) {
    return { message: "path is required (e.g. '/forecast').", isError: true };
  }

  type RawParam = {
    name?: unknown;
    type?: unknown;
    required?: unknown;
    description?: unknown;
  };
  const rawParams = Array.isArray(args.parameters)
    ? (args.parameters as RawParam[])
    : [];
  const parameters = rawParams
    .filter((p) => typeof p?.name === "string")
    .map((p) => {
      const t =
        p.type === "integer" ||
        p.type === "number" ||
        p.type === "boolean" ||
        p.type === "string"
          ? p.type
          : ("string" as const);
      return {
        name: String(p.name),
        in: "query" as const,
        type: t as "string" | "integer" | "number" | "boolean",
        required: !!p.required,
        description: typeof p.description === "string" ? p.description : "",
      };
    });

  const description =
    typeof args.description === "string" ? args.description : `${method} ${path}`;
  const newEndpoint = {
    id: nanoid(8),
    toolName,
    description,
    method,
    path,
    parameters,
    enabled: true,
  };

  const restNodeId = restNode.id;
  let movedFrom: string | null = null;
  await updateProjectGraph(
    { userId: ctx.userId },
    ctx.currentProjectId,
    (p) => {
      // Auto-heal: if the same toolName lives on a DIFFERENT REST source
      // (a leftover from an earlier wrong-target add), remove it there.
      // This is exactly the bug that broke the Open-Meteo two-source flow.
      for (const n of p.nodes) {
        if (n.id === restNodeId) continue;
        if (n.data.kind !== "source.rest") continue;
        const before = n.data.endpoints.length;
        n.data.endpoints = n.data.endpoints.filter(
          (e) => e.toolName !== toolName,
        );
        if (n.data.endpoints.length < before) {
          movedFrom = n.data.name;
          n.data.status = n.data.endpoints.some((e) => e.enabled)
            ? "ready"
            : "draft";
        }
      }

      const node = p.nodes.find((n) => n.id === restNodeId);
      if (!node || node.data.kind !== "source.rest") return;
      // Same toolName on the SAME source is a no-op (idempotent retry).
      if (node.data.endpoints.some((e) => e.toolName === toolName)) return;
      node.data.endpoints = [...node.data.endpoints, newEndpoint];
      node.data.status = node.data.endpoints.some((e) => e.enabled)
        ? "ready"
        : "draft";
    },
  );

  const moveNote = movedFrom
    ? ` (auto-healed: moved this tool from the wrong source '${movedFrom}')`
    : "";
  return {
    message: `Defined endpoint '${toolName}' (${method} ${path}) on REST source '${restNode.data.name}'${moveNote}. The source is now ready; the MCP exposes this tool. ${parameters.length} parameter(s).`,
    data: {
      toolName,
      method,
      path,
      sourceName: restNode.data.name,
      parameters: parameters.map((p) => p.name),
      movedFrom,
    },
    projectUpdated: true,
  };
}

async function toolAddDocumentsSource(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  if (!ctx.currentProjectId) {
    return { message: "Call create_project first.", isError: true };
  }
  const resourceName = String(args.resourceName ?? "documents")
    .replace(/[^a-z0-9_]/gi, "_")
    .toLowerCase();

  const existing = await getProject({ userId: ctx.userId }, ctx.currentProjectId);
  if (!existing) {
    return { message: "Project not found.", isError: true };
  }
  const existingDocsNode = existing.nodes.find(
    (n) => n.data.kind === "source.documents",
  );

  // Path 1: a Documents node already exists. Reuse it — and reuse or add a
  // collection with the requested resourceName. This is the common case
  // after the user drops files into chat (which mints a 'chat_uploads'
  // collection client-side and indexes against it).
  if (existingDocsNode && existingDocsNode.data.kind === "source.documents") {
    const docsData = existingDocsNode.data;
    const fileCount = docsData.collections.reduce(
      (n, c) => n + c.files.length,
      0,
    );
    const existingCollection = docsData.collections.find(
      (c) => c.resourceName === resourceName,
    );
    if (existingCollection) {
      return {
        message: `A Documents source already exists with the '${resourceName}' collection (${existingCollection.files.length} file(s) so far). Nothing to add — files dropped into chat or the right-hand panel land here automatically.`,
        data: {
          nodeId: existingDocsNode.id,
          collectionId: existingCollection.id,
          reused: true,
        },
      };
    }
    // Add a new collection inside the existing node
    const newCollection = {
      id: nanoid(8),
      resourceName,
      description: String(args.name ?? ""),
      files: [],
      chunkSize: 1000,
      enabled: true,
    };
    const docsNodeId = existingDocsNode.id;
    await updateProjectGraph({ userId: ctx.userId }, ctx.currentProjectId, (p) => {
      const node = p.nodes.find((n) => n.id === docsNodeId);
      if (!node || node.data.kind !== "source.documents") return;
      node.data.collections = [...node.data.collections, newCollection];
    });
    return {
      message: `Added a new '${resourceName}' collection to the existing Documents source (it already had ${fileCount} file(s) across other collections). Files dropped into chat will index into 'chat_uploads' by default; you can move them later from the right-hand panel.`,
      data: {
        nodeId: existingDocsNode.id,
        collectionId: newCollection.id,
        reused: true,
      },
      projectUpdated: true,
    };
  }

  // Path 2: no Documents node yet — create one with the requested collection.
  const node = createNode("source.documents", { x: 80, y: 80 });
  const data = node.data as DocumentsSourceData & { kind: "source.documents" };
  data.name = String(args.name ?? "Documents");
  data.collections = [
    {
      id: nanoid(8),
      resourceName,
      description: "",
      files: [],
      chunkSize: 1000,
      enabled: true,
    },
  ];
  await addNodeToProject({ userId: ctx.userId }, ctx.currentProjectId, node);
  return {
    message: `Added Documents node '${data.name}' with an empty '${resourceName}' collection. The user can drop files directly into the chat or use the right-hand panel; either way they'll be indexed into this collection.`,
    data: { nodeId: node.id, collectionId: data.collections[0].id },
    projectUpdated: true,
  };
}

/**
 * Project health report — the single source of truth for "is this project
 * publishable, and if not, why?". Both check_project_health (the model-
 * callable tool) and publish_project (the server-enforced gate) call this.
 *
 * Karpathy critique: we previously had three implementations of this logic
 * (summarizeProject in harness.ts, this function, and publish's preflight).
 * Down to two: summarizeProject (the model-facing string for the system
 * prompt) and this one (the structured truth).
 */
interface SourceIssue {
  source: string;
  kind: string;
  problem: string;
}

interface ProjectHealth {
  sources: number;
  wiredSources: number;
  toolCount: number;
  readyToPublish: boolean;
  issues: SourceIssue[];
  summary: string;
}

export async function computeProjectHealth(
  project: McpProject,
): Promise<ProjectHealth> {
  const output = project.nodes.find((n) => n.data.kind === "output.mcp");
  const sources = project.nodes.filter((n) => n.data.kind !== "output.mcp");
  const wired = new Set(
    output
      ? project.edges
          .filter((e) => e.target === output.id)
          .map((e) => e.source)
      : [],
  );

  const issues: SourceIssue[] = [];
  for (const n of sources) {
    if (!wired.has(n.id)) {
      issues.push({
        source: n.data.name,
        kind: n.data.kind,
        problem: "Not connected to the MCP output node.",
      });
    }
    if (n.data.kind === "source.documents") {
      const enabled = n.data.collections.filter((c) => c.enabled);
      if (enabled.length === 0) {
        issues.push({
          source: n.data.name,
          kind: n.data.kind,
          problem: "Documents source has no enabled collections.",
        });
      } else {
        const indexed = await listIndexedFiles(project.id).catch(() => []);
        if (indexed.length === 0) {
          issues.push({
            source: n.data.name,
            kind: n.data.kind,
            problem:
              "No files indexed yet — user needs to drop files in chat or the right-hand panel.",
          });
        }
      }
    } else if (n.data.kind === "source.database") {
      if (!n.data.host || !n.data.database) {
        issues.push({
          source: n.data.name,
          kind: n.data.kind,
          problem: "Database connection details are incomplete.",
        });
      } else if (n.data.tables.filter((t) => t.enabled).length === 0) {
        issues.push({
          source: n.data.name,
          kind: n.data.kind,
          problem:
            "No tables enabled. Run discover_database_tables to enumerate them.",
        });
      } else if (!project.secrets[n.data.passwordEnvVar]) {
        issues.push({
          source: n.data.name,
          kind: n.data.kind,
          problem: `Missing password secret (${n.data.passwordEnvVar}).`,
        });
      }
    } else if (n.data.kind === "source.rest") {
      if (!n.data.baseUrl) {
        issues.push({
          source: n.data.name,
          kind: n.data.kind,
          problem: "REST source has no base URL.",
        });
      } else if (n.data.endpoints.filter((e) => e.enabled).length === 0) {
        issues.push({
          source: n.data.name,
          kind: n.data.kind,
          problem:
            "No endpoints enabled. Configure at least one in the builder UI or via an OpenAPI import.",
        });
      }
    }
  }

  const toolCount = runtimeListTools(project).length;
  const readyToPublish = sources.length > 0 && issues.length === 0 && toolCount > 0;
  const summary = readyToPublish
    ? `Healthy. ${sources.length} source(s) wired, ${toolCount} tool(s) exposed.`
    : sources.length === 0
      ? "Project has no sources yet — add a database, REST API, or documents source first."
      : `${issues.length} blocker(s) need fixing before publish will succeed: ${issues
          .map((i) => `${i.source} (${i.problem})`)
          .join("; ")}`;

  return {
    sources: sources.length,
    wiredSources: wired.size,
    toolCount,
    readyToPublish,
    issues,
    summary,
  };
}

async function toolCheckProjectHealth(
  ctx: ToolContext,
): Promise<ToolHandlerResult> {
  if (!ctx.currentProjectId) {
    return { message: "No project to inspect.", isError: true };
  }
  const project = await getProject({ userId: ctx.userId }, ctx.currentProjectId);
  if (!project) return { message: "Project not found.", isError: true };
  const health = await computeProjectHealth(project);
  return {
    message: health.readyToPublish
      ? `${health.summary} Safe to publish.`
      : health.summary,
    data: {
      sources: health.sources,
      wiredSources: health.wiredSources,
      toolCount: health.toolCount,
      readyToPublish: health.readyToPublish,
      issues: health.issues,
    },
  };
}

async function toolPublishProject(ctx: ToolContext): Promise<ToolHandlerResult> {
  if (!ctx.currentProjectId) {
    return { message: "No project to publish.", isError: true };
  }
  const project = await getProject({ userId: ctx.userId }, ctx.currentProjectId);
  if (!project) return { message: "Project not found.", isError: true };

  // Server-enforce the health check — regardless of whether the model
  // remembered to call check_project_health first. Codex's pattern: the
  // verification gate is the harness's job, not the model's.
  const health = await computeProjectHealth(project);
  if (!health.readyToPublish) {
    return {
      message: `Can't publish — ${health.summary}`,
      data: { issues: health.issues, toolCount: health.toolCount },
      isError: true,
    };
  }

  await savePublishedProject(project, ctx.userId);
  const slug = outputSlug(project);
  const tools = runtimeListTools(project);
  return {
    message: `Published. ${tools.length} tool(s) live at /api/mcp/${slug} — AI clients can connect now.`,
    data: {
      slug,
      url: `/api/mcp/${slug}`,
      toolCount: tools.length,
      tools: tools.map((t) => t.name),
    },
    projectUpdated: true,
  };
}

function outputSlug(project: McpProject): string {
  const out = project.nodes.find((n) => n.data.kind === "output.mcp");
  return out && out.data.kind === "output.mcp" ? out.data.slug : "";
}
