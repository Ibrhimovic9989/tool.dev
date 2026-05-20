import { nanoid } from "nanoid";
import type { McpNode, NodeKind } from "./types";

export function createNode(
  kind: NodeKind,
  position: { x: number; y: number },
): McpNode {
  const id = `n_${nanoid(8)}`;
  switch (kind) {
    case "source.rest":
      return {
        id,
        type: kind,
        position,
        data: {
          kind: "source.rest",
          name: "REST API",
          description: "Connect to a REST API your agency already runs",
          status: "draft",
          baseUrl: "",
          auth: { kind: "none" },
          endpoints: [],
        },
      };
    case "source.database":
      return {
        id,
        type: kind,
        position,
        data: {
          kind: "source.database",
          name: "Database",
          description: "Read-only access to one of your databases",
          status: "draft",
          engine: "postgres",
          host: "",
          port: 5432,
          database: "",
          username: "",
          passwordEnvVar: "DB_PASSWORD",
          ssl: true,
          tables: [],
        },
      };
    case "source.documents":
      return {
        id,
        type: kind,
        position,
        data: {
          kind: "source.documents",
          name: "Documents",
          description: "Make a folder of documents searchable by AI",
          status: "draft",
          sourceKind: "upload",
          collections: [],
        },
      };
    case "source.webpage":
      return {
        id,
        type: kind,
        position,
        data: {
          kind: "source.webpage",
          name: "Website",
          description: "Pull content from a public website",
          status: "draft",
          targets: [],
          refreshHours: 24,
        },
      };
    case "output.mcp":
      return {
        id,
        type: kind,
        position,
        data: {
          kind: "output.mcp",
          name: "MCP Server",
          description: "This is what AI assistants will connect to",
          status: "draft",
          slug: `mcp-${nanoid(6).toLowerCase()}`,
          transport: "http",
          visibility: "private",
        },
      };
  }
}

export function blankProject(name = "Untitled MCP"): import("./types").McpProject {
  const now = Date.now();
  const id = `p_${nanoid(10)}`;
  // Seed canvas with an MCP Server node so users see a target to connect things to.
  const output = createNode("output.mcp", { x: 720, y: 220 });
  return {
    id,
    name,
    agency: "",
    description: "",
    nodes: [output],
    edges: [],
    secrets: {},
    createdAt: now,
    updatedAt: now,
  };
}
