import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { auth } from "@/auth";
import { getDb, schema } from "@/db/client";
import { saveProject, getProject } from "@/lib/server/projects-service";
import type { McpProject } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Sync a localStorage-resident project into Postgres under the current user
 * and return the conversation ID the agent should use when chatting about
 * this project. Idempotent — running again just updates fields.
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as {
    project?: McpProject;
  } | null;
  const project = body?.project;
  if (!project?.id || !Array.isArray(project.nodes)) {
    return NextResponse.json(
      { error: "Missing or malformed project" },
      { status: 400 },
    );
  }

  // Refuse to overwrite a project that already belongs to someone else.
  const existing = await getProject({ userId }, project.id).catch(() => null);
  if (existing === null) {
    // Either doesn't exist yet, or is owned by a different user; check raw.
    const db = getDb();
    const rows = await db
      .select({ ownerId: schema.projects.ownerId })
      .from(schema.projects)
      .where(eq(schema.projects.id, project.id))
      .limit(1);
    if (rows[0] && rows[0].ownerId && rows[0].ownerId !== userId) {
      return NextResponse.json(
        { error: "This project ID is taken by another account." },
        { status: 409 },
      );
    }
  }

  await saveProject({ userId }, project);

  // Find or create a conversation for this project.
  const db = getDb();
  const conv = await db
    .select()
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.userId, userId),
        eq(schema.conversations.projectId, project.id),
      ),
    )
    .limit(1);
  let conversationId: string;
  if (conv.length > 0) {
    conversationId = conv[0].id;
  } else {
    conversationId = `c_${nanoid(12)}`;
    await db.insert(schema.conversations).values({
      id: conversationId,
      userId,
      projectId: project.id,
      title: project.name.slice(0, 60),
    });
  }
  return NextResponse.json({ projectId: project.id, conversationId });
}
