// Server-side project store. Now backed by Supabase Postgres via Drizzle —
// the previous file-based implementation has been retired.

import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { McpProject } from "@/lib/types";

export async function savePublishedProject(
  project: McpProject,
  ownerId: string,
): Promise<void> {
  const slug = getSlug(project);
  if (!slug) throw new Error("Project has no MCP Server slug");
  const db = getDb();

  // Slim down the body: drop the duplicate `secrets` block (lives in its own
  // column) but keep nodes/edges so the canvas can be re-hydrated.
  const { secrets, ...rest } = project;

  await db
    .insert(schema.projects)
    .values({
      id: project.id,
      slug,
      ownerId,
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
        ownerId,
        name: project.name,
        agency: project.agency ?? "",
        description: project.description ?? "",
        body: rest,
        secrets: secrets ?? {},
        updatedAt: new Date(),
      },
    });
}

export async function loadPublishedProject(
  slug: string,
): Promise<McpProject | null> {
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) return null;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.slug, slug))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
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

export async function deletePublishedProject(slug: string): Promise<void> {
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) return;
  const db = getDb();
  await db.delete(schema.projects).where(eq(schema.projects.slug, slug));
}

function getSlug(project: McpProject): string | null {
  const out = project.nodes.find((n) => n.data.kind === "output.mcp");
  if (!out || out.data.kind !== "output.mcp") return null;
  return out.data.slug || null;
}
