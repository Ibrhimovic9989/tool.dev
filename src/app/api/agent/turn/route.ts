import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { eq, and } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb, schema } from "@/db/client";
import { runAgentTurn } from "@/lib/agent/harness";
import { getProject } from "@/lib/server/projects-service";

export const runtime = "nodejs";
// Tool harness loops can take a while (DB discovery + multi-step reasoning).
export const maxDuration = 90;

interface Body {
  /** Existing conversation id, or empty/new for a fresh thread */
  conversationId?: string;
  /** What the user just typed */
  message: string;
}

export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.message?.trim()) {
    return NextResponse.json({ error: "Missing message" }, { status: 400 });
  }

  const db = getDb();

  // Resolve or create the conversation. We scope to the calling user so a
  // malicious id from the client can't write into someone else's thread.
  let conversationId = body.conversationId;
  let currentProjectId: string | null = null;

  if (conversationId) {
    const rows = await db
      .select()
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.id, conversationId),
          eq(schema.conversations.userId, userId),
        ),
      )
      .limit(1);
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }
    currentProjectId = rows[0].projectId;
  } else {
    conversationId = `c_${nanoid(12)}`;
    await db.insert(schema.conversations).values({
      id: conversationId,
      userId,
      title: body.message.slice(0, 60),
    });
  }

  const result = await runAgentTurn({
    userId,
    conversationId,
    userMessage: body.message,
    currentProjectId,
  });

  // If the project changed, include the latest snapshot so the client can
  // re-render the canvas without an extra round trip.
  let project = null;
  if (result.currentProjectId) {
    project = await getProject({ userId }, result.currentProjectId);
  }

  return NextResponse.json({
    conversationId,
    events: result.events,
    currentProjectId: result.currentProjectId,
    projectChanged: result.projectChanged,
    project,
  });
}
