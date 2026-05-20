// Domain types for the MCP graph.
// Designed for non-technical users: each "node" is something an agency already has
// (an API, a database, a folder of documents, a website) plus an output MCP server.

export type NodeKind =
  | "source.rest"
  | "source.database"
  | "source.documents"
  | "source.webpage"
  | "output.mcp";

// Base config carried by every node.
export interface BaseNodeData {
  name: string;
  description: string;
  /** "draft" = not yet usable; "ready" = configured enough to deploy */
  status: "draft" | "ready" | "error";
}

// ─────────────────────────────────────────────────────────────────────────────
// REST API source
// ─────────────────────────────────────────────────────────────────────────────

export type AuthKind = "none" | "apiKey" | "bearer" | "basic";

export interface RestEndpoint {
  id: string;
  /** What the AI will see as the tool name, e.g. "search_citizens" */
  toolName: string;
  /** Plain-English description for the AI */
  description: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  /** Pulled from OpenAPI or user-defined */
  parameters: RestParam[];
  enabled: boolean;
}

export interface RestParam {
  name: string;
  in: "query" | "path" | "header" | "body";
  type: "string" | "integer" | "number" | "boolean";
  required: boolean;
  description: string;
}

export interface RestSourceData extends BaseNodeData {
  baseUrl: string;
  auth: {
    kind: AuthKind;
    /** For apiKey: header name; for basic: username; for bearer: ignored */
    keyName?: string;
    /** Stored as env var reference, e.g. "API_KEY" */
    secretEnvVar?: string;
  };
  endpoints: RestEndpoint[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Database source
// ─────────────────────────────────────────────────────────────────────────────

export type DbEngine = "postgres" | "mysql" | "mssql";

export interface DbTable {
  id: string;
  schema: string;
  name: string;
  /** Friendly name the AI sees, e.g. "list_health_facilities" */
  toolName: string;
  description: string;
  /** Read-only by default — keeps non-tech users safe */
  readOnly: boolean;
  /** Optional WHERE clause appended to every query for row-level filtering */
  rowFilter?: string;
  enabled: boolean;
}

export interface DatabaseSourceData extends BaseNodeData {
  engine: DbEngine;
  host: string;
  port: number;
  database: string;
  username: string;
  /** Env var reference, e.g. "DB_PASSWORD" */
  passwordEnvVar: string;
  ssl: boolean;
  tables: DbTable[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Documents source
// ─────────────────────────────────────────────────────────────────────────────

export type DocSourceKind = "upload" | "sharepoint" | "gdrive" | "url";

export interface DocCollection {
  id: string;
  /** Resource name surfaced to the AI, e.g. "health_policy_documents" */
  resourceName: string;
  description: string;
  /** For upload kind: the filenames the user uploaded (stored in blob) */
  files: { name: string; size: number; mime: string; blobKey?: string }[];
  /** For sharepoint/gdrive: the share URL or folder ID */
  sourceLocation?: string;
  chunkSize: number;
  enabled: boolean;
}

export interface DocumentsSourceData extends BaseNodeData {
  sourceKind: DocSourceKind;
  collections: DocCollection[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Web pages source
// ─────────────────────────────────────────────────────────────────────────────

export interface WebTarget {
  id: string;
  url: string;
  resourceName: string;
  description: string;
  followLinks: boolean;
  maxDepth: number;
  enabled: boolean;
}

export interface WebpageSourceData extends BaseNodeData {
  targets: WebTarget[];
  refreshHours: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP Server output
// ─────────────────────────────────────────────────────────────────────────────

export type Transport = "http" | "stdio" | "both";

export interface McpOutputData extends BaseNodeData {
  /** The user-facing slug, used in the hosted URL: mcp.makemcp.dev/<slug> */
  slug: string;
  transport: Transport;
  /** Optional rate limit per minute on hosted version */
  rateLimitPerMin?: number;
  /** Public means anyone with the URL can use it; private requires an auth token */
  visibility: "public" | "private";
}

// ─────────────────────────────────────────────────────────────────────────────
// Discriminated union for nodes
// ─────────────────────────────────────────────────────────────────────────────

export type NodeData =
  | ({ kind: "source.rest" } & RestSourceData)
  | ({ kind: "source.database" } & DatabaseSourceData)
  | ({ kind: "source.documents" } & DocumentsSourceData)
  | ({ kind: "source.webpage" } & WebpageSourceData)
  | ({ kind: "output.mcp" } & McpOutputData);

export interface McpProject {
  id: string;
  name: string;
  agency: string;
  description: string;
  nodes: McpNode[];
  edges: McpEdge[];
  /**
   * Secret values keyed by env var name (DB_PASSWORD, API_TOKEN, etc.).
   * Stored on-device in localStorage. Used to auto-fill the in-builder Test
   * panel and (optionally) baked into the .env file when downloading code.
   * Never sent to the AI provider — only the user's natural-language prompt
   * is, and that prompt may already contain the secret.
   */
  secrets: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export interface McpNode {
  id: string;
  type: NodeKind;
  position: { x: number; y: number };
  data: NodeData;
}

export interface McpEdge {
  id: string;
  source: string;
  target: string;
}

// Helpful constants for the palette
export const NODE_LABELS: Record<NodeKind, { title: string; tagline: string }> =
  {
    "source.rest": {
      title: "API",
      tagline: "Connect a REST API",
    },
    "source.database": {
      title: "Database",
      tagline: "Connect a database",
    },
    "source.documents": {
      title: "Documents",
      tagline: "Upload PDFs, Word, files",
    },
    "source.webpage": {
      title: "Website",
      tagline: "Crawl public pages",
    },
    "output.mcp": {
      title: "MCP Server",
      tagline: "Where the AI connects",
    },
  };
