import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb, schema } from "@/db/client";
import { getProject } from "@/lib/server/projects-service";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const convRows = await db
    .select()
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.id, id),
        eq(schema.conversations.userId, userId),
      ),
    )
    .limit(1);
  const conv = convRows[0];
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const msgs = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, id))
    .orderBy(asc(schema.messages.createdAt));
  const project = conv.projectId
    ? await getProject({ userId }, conv.projectId)
    : null;
  return NextResponse.json({ conversation: conv, messages: msgs, project });
}
