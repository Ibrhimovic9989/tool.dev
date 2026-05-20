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
      "Start a new MCP project for the user. Required as the first step before any other source or publish call. Sets the active project.",
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
    name: "add_database_source",
    description:
      "Connect a PostgreSQL database to the current project. Accepts a postgres:// connection string; the password is parsed out and stored as DB_PASSWORD in the project's secrets (never echoed back).",
    parameters: {
      type: "object",
      properties: {
        connectionString: {
          type: "string",
          description: "Full postgres:// or postgresql:// URL with credentials",
        },
        name: {
          type: "string",
          description: "Optional friendly name for this database node",
        },
      },
      required: ["connectionString"],
    },
  },
  {
    name: "discover_database_tables",
    description:
      "List every table in the public schema of the currently-attached database, register each as an MCP tool the user can expose. Requires that add_database_source has run first and that the password is in secrets.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "add_rest_source",
    description:
      "Attach a REST API to the project. Endpoints can be added later via the builder UI (or a future OpenAPI tool). Stores no secret unless authEnvVar is provided.",
    parameters: {
      type: "object",
      properties: {
        baseUrl: { type: "string", description: "https://api.example.com" },
        name: { type: "string" },
        authKind: {
          type: "string",
          enum: ["none", "apiKey", "bearer", "basic"],
        },
        authHeaderName: {
          type: "string",
          description: "Only for apiKey auth, e.g. 'X-API-Key'",
        },
        authEnvVar: {
          type: "string",
          description: "Env var name where the token lives, e.g. 'API_TOKEN'",
        },
      },
      required: ["baseUrl"],
    },
  },
  {
    name: "add_documents_source",
    description:
      "Add a Documents node so the user can upload PDFs / Office files / images later. Doesn't index anything by itself.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        resourceName: {
          type: "string",
          description:
            "snake_case identifier for the collection (e.g. 'policies'). Defaults to 'documents'.",
        },
      },
      required: [],
    },
  },
  {
    name: "publish_project",
    description:
      "Persist the current project to the live MCP runtime. Returns the public URL that AI clients connect to. Refuses if any source is still in draft.",
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
      case "add_database_source":
        return await toolAddDatabaseSource(ctx, args);
      case "discover_database_tables":
        return await toolDiscoverDatabaseTables(ctx);
      case "add_rest_source":
        return await toolAddRestSource(ctx, args);
      case "add_documents_source":
        return await toolAddDocumentsSource(ctx, args);
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

  return {
    message: `Attached database '${data.name}' at ${data.host}:${data.port}/${data.database} as user '${data.username}'. Password saved as ${data.passwordEnvVar}. Run discover_database_tables next to expose tables as MCP tools.`,
    data: { nodeId: node.id, host: data.host, database: data.database },
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
    message: `Attached REST API '${data.name}' at ${baseUrl}. Auth: ${authKind}. Add endpoints from the builder UI or via OpenAPI import in a follow-up step.`,
    data: { nodeId: node.id },
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
    message: `Added Documents node '${data.name}' with an empty '${resourceName}' collection. The user uploads files from the right-hand panel — I can't upload from chat.`,
    data: { nodeId: node.id, collectionId: data.collections[0].id },
    projectUpdated: true,
  };
}

async function toolPublishProject(ctx: ToolContext): Promise<ToolHandlerResult> {
  if (!ctx.currentProjectId) {
    return { message: "No project to publish.", isError: true };
  }
  const project = await getProject({ userId: ctx.userId }, ctx.currentProjectId);
  if (!project) return { message: "Project not found.", isError: true };
  const draftNodes = project.nodes.filter(
    (n) => n.data.kind !== "output.mcp" && n.data.status !== "ready",
  );
  if (draftNodes.length > 0) {
    return {
      message: `Can't publish — these sources are still in draft: ${draftNodes
        .map((n) => n.data.name)
        .join(", ")}.`,
      isError: true,
    };
  }
  await savePublishedProject(project, ctx.userId);
  const slug = outputSlug(project);
  return {
    message: `Published. The MCP is live and AI clients can connect to it now.`,
    data: { slug, url: `/api/mcp/${slug}` },
    projectUpdated: true,
  };
}

function outputSlug(project: McpProject): string {
  const out = project.nodes.find((n) => n.data.kind === "output.mcp");
  return out && out.data.kind === "output.mcp" ? out.data.slug : "";
}
