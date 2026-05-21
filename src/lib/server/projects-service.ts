// Server-side project CRUD. The agent and the new /app canvas both go
// through this. localStorage is dead for authed users.

import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/db/client";
import { blankProject } from "@/lib/factory";
import type { McpProject, McpNode, NodeKind } from "@/lib/types";

interface OwnerScope {
  userId: string;
}

export async function createProject(
  scope: OwnerScope,
  name: string,
  description = "",
  agency = "",
): Promise<McpProject> {
  const project = blankProject(name || "Untitled MCP");
  project.description = description;
  project.agency = agency;
  await saveProject(scope, project);
  return project;
}

export async function getProject(
  scope: OwnerScope,
  projectId: string,
): Promise<McpProject | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.ownerId, scope.userId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return hydrate(row);
}

export async function listProjects(scope: OwnerScope): Promise<McpProject[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.ownerId, scope.userId))
    .orderBy(desc(schema.projects.updatedAt));
  return rows.map(hydrate);
}

/**
 * Safety net: ensure every non-output node has an edge into the MCP output
 * node. The MCP runtime's connectedSources() requires explicit edges, so a
 * missing wire silently turns a published MCP into "0 tools". This function
 * fixes that on every save — both the agent path (which already does it via
 * addNodeToProject) and the chat-panel path (which mutates Zustand directly
 * and historically forgot).
 */
export function autoWireToOutput(project: McpProject): void {
  const output = project.nodes.find((n) => n.data.kind === "output.mcp");
  if (!output) return;
  const wired = new Set(
    project.edges
      .filter((e) => e.target === output.id)
      .map((e) => e.source),
  );
  for (const n of project.nodes) {
    if (n.data.kind === "output.mcp") continue;
    if (wired.has(n.id)) continue;
    project.edges.push({
      id: `e_${n.id}_${output.id}`,
      source: n.id,
      target: output.id,
    });
  }
}

export async function saveProject(
  scope: OwnerScope,
  project: McpProject,
): Promise<void> {
  autoWireToOutput(project);

  const db = getDb();
  const slug =
    project.nodes.find((n) => n.data.kind === "output.mcp")?.data?.kind ===
    "output.mcp"
      ? (project.nodes.find((n) => n.data.kind === "output.mcp")!.data as {
          slug: string;
        }).slug
      : `mcp-${nanoid(6).toLowerCase()}`;

  const { secrets, ...rest } = project;
  await db
    .insert(schema.projects)
    .values({
      id: project.id,
      slug,
      ownerId: scope.userId,
      name: project.name,
      agency: project.agency ?? "",
      description: project.description ?? "",
      body: rest,
      secrets: secrets ?? {},
    })
    .onConflictDoUpdate({
      target: schema.projects.id,
      set: {
        slug,
        name: project.name,
        agency: project.agency ?? "",
        description: project.description ?? "",
        body: rest,
        secrets: secrets ?? {},
        updatedAt: new Date(),
      },
    });
}

export async function updateProjectGraph(
  scope: OwnerScope,
  projectId: string,
  mutator: (project: McpProject) => void,
): Promise<McpProject> {
  const project = await getProject(scope, projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);
  mutator(project);
  project.updatedAt = Date.now();
  await saveProject(scope, project);
  return project;
}

export async function addNodeToProject(
  scope: OwnerScope,
  projectId: string,
  node: McpNode,
  connectToOutput = true,
): Promise<McpProject> {
  return updateProjectGraph(scope, projectId, (p) => {
    p.nodes.push(node);
    if (connectToOutput) {
      const output = p.nodes.find((n) => n.data.kind === "output.mcp");
      if (output) {
        p.edges.push({
          id: `e_${node.id}_${output.id}`,
          source: node.id,
          target: output.id,
        });
      }
    }
  });
}

export async function setProjectSecret(
  scope: OwnerScope,
  projectId: string,
  envVar: string,
  value: string,
): Promise<McpProject> {
  return updateProjectGraph(scope, projectId, (p) => {
    p.secrets = { ...p.secrets, [envVar]: value };
  });
}

export type NodeKindLite = Exclude<NodeKind, "output.mcp">;

function hydrate(row: typeof schema.projects.$inferSelect): McpProject {
  const body = row.body as Omit<McpProject, "secrets">;
  return {
    ...body,
    id: row.id,
    name: row.name,
    agency: row.agency,
    description: row.description,
    secrets: (row.secrets as Record<string, string>) ?? {},
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}
