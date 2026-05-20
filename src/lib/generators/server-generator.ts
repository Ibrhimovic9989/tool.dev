// Generates a runnable Node.js MCP server from a project graph.
// Output is a set of files (filename -> contents) that are zipped and downloaded.

import type {
  McpProject,
  McpNode,
  RestSourceData,
  DatabaseSourceData,
  DocumentsSourceData,
  WebpageSourceData,
} from "@/lib/types";
import type { ProjectVectors } from "@/lib/docs/store";

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface GenerateOptions {
  /**
   * When provided, an actual `.env` file is also written into the zip,
   * pre-filled with these values. The `.env.example` (placeholders only) is
   * still emitted alongside as a sharable template.
   *
   * Keys are env var names (e.g. DB_PASSWORD, API_TOKEN).
   */
  bakedSecrets?: Record<string, string>;

  /**
   * Pre-computed embeddings for every Documents collection in the project.
   * When present, the generated server bundles these and exposes
   * `search_<name>` / `find_similar_<name>` tools backed by them. The server
   * still needs AZURE_OPENAI_* env vars at runtime so it can embed the
   * caller's query — only the corpus embeddings are bundled.
   */
  vectors?: ProjectVectors;
}

export function generateServerFiles(
  project: McpProject,
  opts: GenerateOptions = {},
): GeneratedFile[] {
  const outputNode = project.nodes.find((n) => n.data.kind === "output.mcp");
  // Only include source nodes connected to the (first) output node.
  const connectedSourceIds = new Set(
    outputNode
      ? project.edges
          .filter((e) => e.target === outputNode.id)
          .map((e) => e.source)
      : project.nodes.filter((n) => n.data.kind !== "output.mcp").map((n) => n.id),
  );
  const sources = project.nodes.filter((n) => connectedSourceIds.has(n.id));

  // Documents support: only bundle vectors that belong to a connected docs
  // node, so a project with stale-but-unused indexes doesn't bloat the zip.
  const docsCollectionIds = new Set<string>();
  for (const n of sources) {
    if (n.data.kind !== "source.documents") continue;
    for (const c of n.data.collections) {
      if (c.enabled && c.resourceName) docsCollectionIds.add(c.id);
    }
  }
  const bundledChunks =
    opts.vectors?.chunks.filter((c) => docsCollectionIds.has(c.collectionId)) ?? [];
  const hasDocs = bundledChunks.length > 0;

  const files: GeneratedFile[] = [
    { path: "package.json", content: renderPackageJson(project) },
    { path: "tsconfig.json", content: renderTsconfig() },
    { path: ".env.example", content: renderEnvExample(sources, hasDocs) },
    { path: ".gitignore", content: "node_modules\ndist\n.env\n.env.local\n" },
    {
      path: "README.md",
      content: renderReadme(project, outputNode, !!opts.bakedSecrets, hasDocs),
    },
    {
      path: "src/index.ts",
      content: renderIndex(project, sources, outputNode, hasDocs),
    },
    { path: "scripts/smoke-test.mjs", content: renderSmokeTest(project, hasDocs) },
    ...sources.flatMap((node) => renderSourceModule(node, hasDocs)),
  ];

  if (hasDocs) {
    files.push(
      {
        path: "data/vectors.json",
        content: JSON.stringify(
          { version: 1, chunks: bundledChunks },
          null,
          0,
        ),
      },
      { path: "src/_runtime/docs.ts", content: renderDocsRuntime() },
    );
  }

  if (opts.bakedSecrets) {
    files.push({
      path: ".env",
      content: renderEnvBaked(sources, opts.bakedSecrets, hasDocs),
    });
  }

  return files;
}

// ─────────────────────────────────────────────────────────────────────────────
// package.json / tsconfig
// ─────────────────────────────────────────────────────────────────────────────

function renderPackageJson(project: McpProject): string {
  return JSON.stringify(
    {
      name: slugify(project.name),
      version: "0.1.0",
      private: true,
      type: "module",
      bin: {
        [slugify(project.name)]: "dist/index.js",
      },
      scripts: {
        build: "tsc",
        start: "node dist/index.js",
        dev: "tsx src/index.ts",
        test: "npm run build && node scripts/smoke-test.mjs",
      },
      dependencies: {
        "@modelcontextprotocol/sdk": "^1.0.4",
        dotenv: "^16.4.5",
        zod: "^3.24.1",
      },
      devDependencies: {
        "@types/node": "^22",
        tsx: "^4.19.2",
        typescript: "^5.7.3",
      },
    },
    null,
    2,
  );
}

function renderTsconfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        outDir: "dist",
        rootDir: "src",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        resolveJsonModule: true,
      },
      include: ["src"],
    },
    null,
    2,
  );
}

/**
 * Collect the env var names every source node will read at runtime, along
 * with a human-readable comment for each. Used by both `.env.example` and
 * the optional baked `.env`.
 */
function collectEnvVars(sources: McpNode[]): { name: string; comment: string }[] {
  const out: { name: string; comment: string }[] = [];
  for (const node of sources) {
    if (node.data.kind === "source.rest" && node.data.auth.secretEnvVar) {
      out.push({
        name: node.data.auth.secretEnvVar,
        comment: `Auth secret for ${node.data.name}`,
      });
    }
    if (node.data.kind === "source.database") {
      out.push({
        name: node.data.passwordEnvVar,
        comment: `Password for database ${node.data.name}`,
      });
    }
  }
  // De-dupe (multiple nodes may share an env var name)
  const seen = new Set<string>();
  return out.filter((e) => (seen.has(e.name) ? false : (seen.add(e.name), true)));
}

const DOC_ENV_VARS: { name: string; comment: string }[] = [
  {
    name: "AZURE_OPENAI_ENDPOINT",
    comment: "Azure OpenAI endpoint (https://<resource>.openai.azure.com)",
  },
  { name: "AZURE_OPENAI_API_KEY", comment: "Azure OpenAI API key" },
  {
    name: "AZURE_OPENAI_EMBEDDING_DEPLOYMENT",
    comment: "Embedding deployment name (e.g. text-embedding-3-small)",
  },
  {
    name: "AZURE_OPENAI_API_VERSION",
    comment: "Optional; defaults to 2024-12-01-preview",
  },
];

function renderEnvExample(sources: McpNode[], hasDocs: boolean): string {
  const lines: string[] = [
    "# Fill in the values below before running this server.",
    "# Generated by makemcp.dev",
    "",
  ];
  for (const e of collectEnvVars(sources)) {
    lines.push(`# ${e.comment}`);
    lines.push(`${e.name}=`);
  }
  if (hasDocs) {
    lines.push("", "# Embeddings — required to search the bundled document corpus");
    for (const e of DOC_ENV_VARS) {
      lines.push(`# ${e.comment}`);
      lines.push(`${e.name}=`);
    }
  }
  return lines.join("\n") + "\n";
}

function renderEnvBaked(
  sources: McpNode[],
  bakedSecrets: Record<string, string>,
  hasDocs: boolean,
): string {
  const lines: string[] = [
    "# DO NOT COMMIT — contains real credentials baked in from the builder.",
    "# Generated by makemcp.dev. .gitignore already excludes this file.",
    "",
  ];
  const declared = collectEnvVars(sources);
  for (const e of declared) {
    lines.push(`# ${e.comment}`);
    lines.push(`${e.name}=${escapeEnvValue(bakedSecrets[e.name] ?? "")}`);
  }
  if (hasDocs) {
    lines.push("", "# Embeddings — required to search the bundled document corpus");
    for (const e of DOC_ENV_VARS) {
      lines.push(`# ${e.comment}`);
      lines.push(`${e.name}=${escapeEnvValue(bakedSecrets[e.name] ?? "")}`);
    }
  }
  // Append any extra secrets the user stored that weren't referenced by any
  // node — keeps them around so the user can wire them up later.
  const declaredNames = new Set([
    ...declared.map((d) => d.name),
    ...(hasDocs ? DOC_ENV_VARS.map((e) => e.name) : []),
  ]);
  const extras = Object.entries(bakedSecrets).filter(
    ([k]) => !declaredNames.has(k),
  );
  if (extras.length) {
    lines.push("", "# Extra secrets saved in the builder (no node uses them yet)");
    for (const [k, v] of extras) lines.push(`${k}=${escapeEnvValue(v)}`);
  }
  return lines.join("\n") + "\n";
}

function escapeEnvValue(v: string): string {
  // Quote if the value contains spaces, #, or other risky chars.
  if (v === "") return "";
  if (/[\s"'`$\\#]/.test(v)) {
    return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return v;
}

// ─────────────────────────────────────────────────────────────────────────────
// README
// ─────────────────────────────────────────────────────────────────────────────

function renderReadme(
  project: McpProject,
  outputNode: McpNode | undefined,
  hasBakedEnv: boolean,
  hasDocs: boolean,
): string {
  const slug =
    outputNode?.data.kind === "output.mcp"
      ? outputNode.data.slug
      : slugify(project.name);

  const envSection = hasBakedEnv
    ? `## Run it

A pre-filled \`.env\` is already in this folder — credentials from the builder
were baked in. **Do not commit this file.**

\`\`\`bash
npm install
npm run dev
\`\`\``
    : `## Run it

\`\`\`bash
npm install
cp .env.example .env   # Windows: copy .env.example .env
# fill in the values in .env
npm run dev
\`\`\``;

  const docsSection = hasDocs
    ? `\n\n## Document search

This package bundles a pre-computed embedding index (\`data/vectors.json\`)
for every Documents collection you configured. At runtime the server uses
Azure OpenAI to embed each search query, then runs cosine similarity over
the bundled corpus.

To search, set the following env vars in addition to anything above:

\`\`\`
AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=text-embedding-3-small
\`\`\`

To refresh the corpus, re-upload your documents in the builder and
re-download the code.`
    : "";

  return `# ${project.name}

${project.description || "A Model Context Protocol server for AI assistants."}

Generated by [makemcp.dev](https://makemcp.dev).

${envSection}${docsSection}

For production:
\`\`\`bash
npm run build
npm start
\`\`\`

## Verify everything works (end-to-end)

\`\`\`bash
npm test
\`\`\`

This builds the server, connects to it as an MCP client over stdio, and checks
that every tool and resource you configured is announced. To also try invoking
each tool with empty args (best-effort), set \`SMOKE_INVOKE=1\`:

\`\`\`bash
SMOKE_INVOKE=1 npm test
\`\`\`

## Connect from Claude Desktop

Edit your Claude Desktop config (\`~/Library/Application Support/Claude/claude_desktop_config.json\` on macOS, \`%APPDATA%/Claude/claude_desktop_config.json\` on Windows) and add:

\`\`\`json
{
  "mcpServers": {
    "${slug}": {
      "command": "node",
      "args": ["${"${PROJECT_DIR}"}/dist/index.js"]
    }
  }
}
\`\`\`

## What's exposed

${project.nodes
  .filter((n) => n.data.kind !== "output.mcp")
  .map((n) => `- **${n.data.name}** — ${n.data.description}`)
  .join("\n")}
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// src/index.ts — the actual MCP server entrypoint
// ─────────────────────────────────────────────────────────────────────────────

function renderIndex(
  project: McpProject,
  sources: McpNode[],
  outputNode: McpNode | undefined,
  hasDocs: boolean,
): string {
  const sourceImports = sources
    .map(
      (n) =>
        `import { tools as tools_${safeId(n.id)}, resources as resources_${safeId(n.id)} } from "./sources/${safeId(n.id)}.js";`,
    )
    .join("\n");

  const toolsAggregate = sources
    .map((n) => `  ...tools_${safeId(n.id)},`)
    .join("\n");
  const resourcesAggregate = sources
    .map((n) => `  ...resources_${safeId(n.id)},`)
    .join("\n");

  const name =
    outputNode?.data.kind === "output.mcp"
      ? outputNode.data.slug
      : slugify(project.name);

  return `// Generated by makemcp.dev — ${new Date().toISOString()}
// Project: ${project.name}

import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

${sourceImports}

interface ToolEntry {
  def: {
    name: string;
    description: string;
    inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  };
  call: (args: Record<string, unknown>) => Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }>;
}

interface ResourceEntry {
  def: {
    name: string;
    uri: string;
    description: string;
    mimeType: string;
  };
  read: () => Promise<{
    contents: { uri: string; mimeType: string; text: string }[];
  }>;
}

const allTools: ToolEntry[] = [
${toolsAggregate || "  // No tools yet"}
];

const allResources: ResourceEntry[] = [
${resourcesAggregate || "  // No resources yet"}
];

async function main() {
  const server = new Server(
    { name: ${JSON.stringify(name)}, version: "0.1.0" },
    {
      capabilities: { tools: {}, resources: {} },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools.map((t) => t.def),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = allTools.find((t) => t.def.name === req.params.name);
    if (!tool) {
      return {
        content: [{ type: "text", text: \`Unknown tool: \${req.params.name}\` }],
        isError: true,
      };
    }
    try {
      return await tool.call((req.params.arguments ?? {}) as Record<string, unknown>);
    } catch (e) {
      return {
        content: [
          { type: "text", text: e instanceof Error ? e.message : String(e) },
        ],
        isError: true,
      };
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: allResources.map((r) => r.def),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const resource = allResources.find((r) => r.def.uri === req.params.uri);
    if (!resource) {
      throw new Error(\`Unknown resource: \${req.params.uri}\`);
    }
    return resource.read();
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(${JSON.stringify(`${name} MCP server running`)});
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-source modules
// ─────────────────────────────────────────────────────────────────────────────

function renderSourceModule(node: McpNode, hasDocs: boolean): GeneratedFile[] {
  const path = `src/sources/${safeId(node.id)}.ts`;
  switch (node.data.kind) {
    case "source.rest":
      return [{ path, content: renderRestSource(node.id, node.data) }];
    case "source.database":
      return [{ path, content: renderDatabaseSource(node.id, node.data) }];
    case "source.documents":
      return [
        { path, content: renderDocumentsSource(node.id, node.data, hasDocs) },
      ];
    case "source.webpage":
      return [{ path, content: renderWebpageSource(node.id, node.data) }];
    default:
      return [];
  }
}

function renderRestSource(_id: string, data: RestSourceData): string {
  const enabled = data.endpoints.filter((e) => e.enabled && e.toolName);

  let authHeaderLine = "";
  if (data.auth.kind === "apiKey") {
    const headerName = data.auth.keyName ?? "X-API-Key";
    const envVar = data.auth.secretEnvVar ?? "API_KEY";
    authHeaderLine = `          ${JSON.stringify(headerName)}: process.env.${envVar} ?? "",`;
  } else if (data.auth.kind === "bearer") {
    const envVar = data.auth.secretEnvVar ?? "API_TOKEN";
    authHeaderLine = `          Authorization: "Bearer " + (process.env.${envVar} ?? ""),`;
  } else if (data.auth.kind === "basic") {
    const envVar = data.auth.secretEnvVar ?? "BASIC_AUTH";
    const user = data.auth.keyName ?? "";
    authHeaderLine = `          Authorization: "Basic " + Buffer.from(${JSON.stringify(user)} + ":" + (process.env.${envVar} ?? "")).toString("base64"),`;
  }

  const toolBlocks = enabled.map((ep) => {
    const propsLines = ep.parameters
      .map(
        (p) =>
          `          ${JSON.stringify(p.name)}: { type: ${JSON.stringify(
            p.type,
          )}, description: ${JSON.stringify(p.description)} },`,
      )
      .join("\n");
    const requiredArr = ep.parameters
      .filter((p) => p.required)
      .map((p) => JSON.stringify(p.name))
      .join(", ");

    return [
      `  {`,
      `    def: {`,
      `      name: ${JSON.stringify(ep.toolName)},`,
      `      description: ${JSON.stringify(ep.description || `${ep.method} ${ep.path}`)},`,
      `      inputSchema: {`,
      `        type: "object" as const,`,
      `        properties: {`,
      propsLines,
      `        },`,
      `        required: [${requiredArr}] as string[],`,
      `      },`,
      `    },`,
      `    call: async (args: Record<string, unknown>) => {`,
      `      let url = baseUrl + ${JSON.stringify(ep.path)};`,
      `      const query = new URLSearchParams();`,
      `      for (const [k, v] of Object.entries(args ?? {})) {`,
      `        if (url.includes(":" + k)) {`,
      `          url = url.replace(":" + k, encodeURIComponent(String(v)));`,
      `        } else {`,
      `          query.set(k, String(v));`,
      `        }`,
      `      }`,
      `      const qs = query.toString();`,
      `      if (qs) url += (url.includes("?") ? "&" : "?") + qs;`,
      `      const res = await fetch(url, {`,
      `        method: ${JSON.stringify(ep.method)},`,
      `        headers: {`,
      authHeaderLine,
      `        },`,
      `      });`,
      `      const text = await res.text();`,
      `      return {`,
      `        content: [{ type: "text" as const, text: "[" + res.status + "] " + text }],`,
      `      };`,
      `    },`,
      `  },`,
    ]
      .filter(Boolean)
      .join("\n");
  });

  return `// REST source: ${data.name}

const baseUrl = ${JSON.stringify(data.baseUrl)};

export const tools = [
${toolBlocks.join("\n")}
];

export const resources: never[] = [];
`;
}

function renderDatabaseSource(_id: string, data: DatabaseSourceData): string {
  const enabledTables = data.tables.filter((t) => t.enabled && t.toolName && t.name);

  const setup =
    data.engine === "postgres"
      ? `import pg from "pg";
const pool = new pg.Pool({
  host: ${JSON.stringify(data.host)},
  port: ${data.port},
  database: ${JSON.stringify(data.database)},
  user: ${JSON.stringify(data.username)},
  password: process.env.${data.passwordEnvVar} ?? "",
  ssl: ${data.ssl},
});`
      : data.engine === "mysql"
        ? `import mysql from "mysql2/promise";
const pool = await mysql.createPool({
  host: ${JSON.stringify(data.host)},
  port: ${data.port},
  database: ${JSON.stringify(data.database)},
  user: ${JSON.stringify(data.username)},
  password: process.env.${data.passwordEnvVar} ?? "",
  ssl: ${data.ssl ? "{}" : "undefined"},
});`
        : `import sql from "mssql";
const pool = await sql.connect({
  server: ${JSON.stringify(data.host)},
  port: ${data.port},
  database: ${JSON.stringify(data.database)},
  user: ${JSON.stringify(data.username)},
  password: process.env.${data.passwordEnvVar} ?? "",
  options: { encrypt: ${data.ssl}, trustServerCertificate: false },
});`;

  const toolEntries = enabledTables.map((t) => {
    const where = t.rowFilter ? ` WHERE ${t.rowFilter}` : "";
    const fullName = `${t.schema}.${t.name}`;
    const sqlText =
      data.engine === "mssql"
        ? `SELECT TOP 100 * FROM ${fullName}${where}`
        : `SELECT * FROM ${fullName}${where} LIMIT 100`;

    const queryRun =
      data.engine === "postgres"
        ? `const { rows } = await pool.query(${JSON.stringify(sqlText)}); return rows;`
        : data.engine === "mysql"
          ? `const [rows] = await pool.query(${JSON.stringify(sqlText)}); return rows;`
          : `const result = await pool.request().query(${JSON.stringify(sqlText)}); return result.recordset;`;

    return `  {
    def: {
      name: ${JSON.stringify(t.toolName)},
      description: ${JSON.stringify(t.description || `Read rows from ${fullName}`)},
      inputSchema: { type: "object" as const, properties: {}, required: [] as string[] },
    },
    call: async () => {
      const rows = await (async () => { ${queryRun} })();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }],
      };
    },
  },`;
  });

  return `// Database source: ${data.name} (${data.engine})
${setup}

export const tools = [
${toolEntries.join("\n")}
];

export const resources: never[] = [];
`;
}

function renderDocumentsSource(
  _id: string,
  data: DocumentsSourceData,
  hasDocs: boolean,
): string {
  const enabled = data.collections.filter((c) => c.enabled && c.resourceName);

  // No bundled vectors → keep this module a no-op stub. The user still sees
  // the Documents node on their canvas; the generated server just doesn't
  // expose search tools for it.
  if (!hasDocs || enabled.length === 0) {
    return `// Documents source: ${data.name}
// No bundled embeddings — re-index in the builder and re-download to enable search.

export const tools: never[] = [];
export const resources: never[] = [];
`;
  }

  const toolBlocks = enabled.flatMap((c) => {
    const safe = c.resourceName.replace(/[^a-z0-9_]/gi, "_").toLowerCase().slice(0, 40);
    return [
      `  {
    def: {
      name: ${JSON.stringify(`search_${safe}`)},
      description: ${JSON.stringify(
        (c.description ? c.description + " " : "") +
          `Semantic search across documents in '${c.resourceName}'.`,
      )},
      inputSchema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Natural-language query" },
          topK: { type: "number", description: "How many passages (default 5)" },
        },
        required: ["query"] as string[],
      },
    },
    call: async (args: Record<string, unknown>) => {
      const query = String(args.query ?? "").trim();
      if (!query) {
        return { content: [{ type: "text" as const, text: "Missing query" }], isError: true };
      }
      const topK = Math.min(20, Math.max(1, Number(args.topK ?? 5) || 5));
      const vec = await embedQuery(query);
      const hits = await searchVectors(${JSON.stringify(c.id)}, vec, topK, 0);
      if (hits.length === 0) {
        return { content: [{ type: "text" as const, text: "No matching passages." }] };
      }
      const formatted = hits.map((h, i) =>
        \`[\${i + 1}] score=\${h.score.toFixed(3)}  \${h.chunk.fileName}\\n\${h.chunk.text}\`
      ).join("\\n\\n---\\n\\n");
      return { content: [{ type: "text" as const, text: formatted }] };
    },
  },`,
      `  {
    def: {
      name: ${JSON.stringify(`find_similar_${safe}`)},
      description: ${JSON.stringify(
        `Given a passage, finds near-duplicate or similar content in '${c.resourceName}'.`,
      )},
      inputSchema: {
        type: "object" as const,
        properties: {
          text: { type: "string", description: "Passage to compare against the corpus" },
          minScore: { type: "number", description: "Cosine threshold 0-1 (default 0.78)" },
          topK: { type: "number", description: "Max matches (default 10)" },
        },
        required: ["text"] as string[],
      },
    },
    call: async (args: Record<string, unknown>) => {
      const text = String(args.text ?? "").trim();
      if (!text) {
        return { content: [{ type: "text" as const, text: "Missing text" }], isError: true };
      }
      const minScore = Math.min(1, Math.max(0, Number(args.minScore ?? 0.78) || 0.78));
      const topK = Math.min(50, Math.max(1, Number(args.topK ?? 10) || 10));
      const vec = await embedQuery(text);
      const hits = await searchVectors(${JSON.stringify(c.id)}, vec, topK, minScore);
      if (hits.length === 0) {
        return { content: [{ type: "text" as const, text: \`No similar passages above \${minScore.toFixed(2)}.\` }] };
      }
      const grouped: Record<string, { score: number; text: string }[]> = {};
      for (const h of hits) {
        (grouped[h.chunk.fileName] ??= []).push({ score: h.score, text: h.chunk.text });
      }
      const lines = Object.entries(grouped).map(([file, items]) => {
        const best = Math.max(...items.map((i) => i.score));
        return \`• \${file}  (best \${best.toFixed(3)}, \${items.length} matching passage\${items.length === 1 ? "" : "s"})\`;
      });
      return { content: [{ type: "text" as const, text: lines.join("\\n") }] };
    },
  },`,
    ];
  });

  return `// Documents source: ${data.name}
import { embedQuery, searchVectors } from "../_runtime/docs.js";

export const tools = [
${toolBlocks.join("\n")}
];

export const resources: never[] = [];
`;
}

function renderWebpageSource(_id: string, data: WebpageSourceData): string {
  const enabled = data.targets.filter((t) => t.enabled && t.url);
  const resourceEntries = enabled.map((t) => {
    const name = t.resourceName || safeId(t.id);
    const uri = `web://${name}`;
    return `  {
    def: {
      name: ${JSON.stringify(name)},
      uri: ${JSON.stringify(uri)},
      description: ${JSON.stringify(t.description)},
      mimeType: "text/html",
    },
    read: async () => {
      const res = await fetch(${JSON.stringify(t.url)});
      const text = await res.text();
      return {
        contents: [
          { uri: ${JSON.stringify(uri)}, mimeType: "text/html", text },
        ],
      };
    },
  },`;
  });

  return `// Web pages source: ${data.name}

export const tools: never[] = [];

export const resources = [
${resourceEntries.join("\n")}
];
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// src/_runtime/docs.ts — dependency-free Azure embedding + cosine search.
// Bundled into the zip when the project has indexed documents.
// ─────────────────────────────────────────────────────────────────────────────

function renderDocsRuntime(): string {
  return `// Runtime for document search tools. Loads the bundled corpus once and
// embeds caller queries on demand via Azure OpenAI.
//
// Env vars expected at runtime:
//   AZURE_OPENAI_ENDPOINT
//   AZURE_OPENAI_API_KEY
//   AZURE_OPENAI_EMBEDDING_DEPLOYMENT
//   AZURE_OPENAI_API_VERSION (optional)

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface ChunkRecord {
  id: string;
  collectionId: string;
  fileId: string;
  fileName: string;
  text: string;
  source?: string;
  embedding: number[];
}

interface StoreShape {
  version: 1;
  chunks: ChunkRecord[];
}

// dist/_runtime/docs.js  ->  ../../data/vectors.json (relative to compiled file)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VECTORS_PATH = path.resolve(__dirname, "..", "..", "data", "vectors.json");

let cache: StoreShape | null = null;
async function load(): Promise<StoreShape> {
  if (cache) return cache;
  const raw = await readFile(VECTORS_PATH, "utf8");
  cache = JSON.parse(raw) as StoreShape;
  return cache;
}

export async function embedQuery(query: string): Promise<number[]> {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const key = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2024-12-01-preview";
  if (!endpoint || !key || !deployment) {
    throw new Error(
      "Document search needs AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, and AZURE_OPENAI_EMBEDDING_DEPLOYMENT.",
    );
  }
  const url = \`\${endpoint}/openai/deployments/\${deployment}/embeddings?api-version=\${apiVersion}\`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": key },
    body: JSON.stringify({ input: [query] }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(\`Embeddings error \${res.status}: \${t}\`);
  }
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data[0].embedding;
}

export interface SearchHit {
  chunk: ChunkRecord;
  score: number;
}

export async function searchVectors(
  collectionId: string,
  queryEmbedding: number[],
  topK: number,
  minScore: number,
): Promise<SearchHit[]> {
  const store = await load();
  const pool = store.chunks.filter((c) => c.collectionId === collectionId);
  if (pool.length === 0) return [];
  const scored = pool.map((c) => ({
    chunk: c,
    score: cosine(queryEmbedding, c.embedding),
  }));
  return scored
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// scripts/smoke-test.mjs — protocol-level end-to-end check
// ─────────────────────────────────────────────────────────────────────────────

function renderSmokeTest(project: McpProject, hasDocs: boolean): string {
  // Generator-time list of expected tools and resources, so the smoke test can
  // diff what the server actually announces vs. what was configured.
  const expectedTools: string[] = [];
  const expectedResources: string[] = [];
  for (const node of project.nodes) {
    if (node.data.kind === "source.rest") {
      for (const ep of node.data.endpoints) {
        if (ep.enabled && ep.toolName) expectedTools.push(ep.toolName);
      }
    } else if (node.data.kind === "source.database") {
      for (const t of node.data.tables) {
        if (t.enabled && t.toolName) expectedTools.push(t.toolName);
      }
    } else if (node.data.kind === "source.documents") {
      for (const c of node.data.collections) {
        if (!c.enabled || !c.resourceName) continue;
        if (hasDocs) {
          const safe = c.resourceName.replace(/[^a-z0-9_]/gi, "_").toLowerCase().slice(0, 40);
          expectedTools.push(`search_${safe}`);
          expectedTools.push(`find_similar_${safe}`);
        }
      }
    } else if (node.data.kind === "source.webpage") {
      for (const t of node.data.targets) {
        if (t.enabled && (t.resourceName || t.id))
          expectedResources.push(t.resourceName || t.id);
      }
    }
  }

  return `#!/usr/bin/env node
// Smoke test generated by makemcp.dev — runs the built server, connects as an
// MCP client over stdio, and verifies every tool and resource is announced and
// callable.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, "..", "dist", "index.js");

const expectedTools = ${JSON.stringify(expectedTools)};
const expectedResources = ${JSON.stringify(expectedResources)};

const reset = "\\x1b[0m";
const green = "\\x1b[32m";
const red = "\\x1b[31m";
const dim = "\\x1b[2m";
const bold = "\\x1b[1m";

function ok(msg) { console.log(\`  \${green}✔\${reset} \${msg}\`); }
function fail(msg) { console.log(\`  \${red}✘\${reset} \${msg}\`); }
function section(msg) { console.log(\`\\n\${bold}\${msg}\${reset}\`); }
function detail(msg) { console.log(\`    \${dim}\${msg}\${reset}\`); }

async function main() {
  console.log(\`\${bold}Smoke test:${" " + slugify(project.name)}\${reset}\`);
  detail("Spawning server: node " + serverPath);

  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath],
    stderr: "inherit",
  });
  const client = new Client({ name: "smoke-test", version: "0.0.1" }, {});
  await client.connect(transport);

  let failures = 0;

  section("Tools (announced)");
  const toolsRes = await client.listTools().catch((e) => ({ tools: [], error: e }));
  const tools = toolsRes.tools ?? [];
  detail(\`Server reports \${tools.length} tool(s)\`);
  for (const name of expectedTools) {
    const found = tools.find((t) => t.name === name);
    if (!found) {
      failures++;
      fail(\`missing tool: \${name}\`);
    } else {
      ok(\`\${name}\`);
    }
  }

  // Best-effort invocation. Many tools require args; we don't pass any here,
  // so failures are expected and informational.
  if (process.env.SMOKE_INVOKE === "1") {
    section("Tools (invocation, best-effort)");
    for (const name of expectedTools) {
      try {
        const result = await client.callTool({ name, arguments: {} });
        if (result?.isError) {
          detail(\`\${name} → isError (likely needs arguments)\`);
        } else {
          ok(\`\${name} responded\`);
        }
      } catch (e) {
        detail(\`\${name} threw: \${e.message}\`);
      }
    }
  }

  section("Resources");
  const resRes = await client.listResources().catch((e) => ({ resources: [], error: e }));
  const resources = resRes.resources ?? [];
  detail(\`Server reports \${resources.length} resource(s)\`);
  for (const name of expectedResources) {
    const found = resources.find((r) => r.name === name);
    if (!found) {
      failures++;
      fail(\`missing resource: \${name}\`);
    } else {
      ok(\`\${name}\`);
    }
  }

  await client.close();

  console.log();
  if (failures === 0) {
    console.log(\`\${green}\${bold}All checks passed.\${reset}\`);
    process.exit(0);
  } else {
    console.log(\`\${red}\${bold}\${failures} failure(s).\${reset}\`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Smoke test crashed:", e);
  process.exit(2);
});
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "mcp-server";
}

function safeId(s: string): string {
  return s.replace(/[^a-z0-9_]/gi, "_");
}
