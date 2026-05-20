import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb, schema } from "@/db/client";

export const runtime = "nodejs";

/**
 * Loads the conversation (if any) associated with a project the calling user
 * owns, plus its full message history rebuilt as the chat-panel's event
 * stream. The chat panel calls this on mount so a page reload restores the
 * transcript next to the persisted canvas state.
 *
 * Query: ?projectId=p_xxx
 * Response: { conversationId: string|null, events: AgentEvent[] }
 */
export async function GET(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
  }
  const db = getDb();
  const convRows = await db
    .select()
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.userId, userId),
        eq(schema.conversations.projectId, projectId),
      ),
    )
    .limit(1);
  if (convRows.length === 0) {
    return NextResponse.json({ conversationId: null, events: [] });
  }
  const conversationId = convRows[0].id;
  const msgs = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(asc(schema.messages.createdAt));

  // Rebuild the event stream the chat panel renders. The DB stores OpenAI-
  // flavored messages (user / assistant-with-tool-calls / tool); the chat
  // panel renders user / assistant / tool_call / tool_result.
  type AgentEvent = {
    kind: "user" | "assistant" | "tool_call" | "tool_result";
    text?: string;
    toolName?: string;
    toolArgs?: Record<string, unknown>;
    toolResult?: { message: string; data?: unknown };
    isError?: boolean;
  };
  const events: AgentEvent[] = [];
  for (const m of msgs) {
    if (m.role === "user" && m.content) {
      events.push({ kind: "user", text: m.content });
    } else if (m.role === "assistant") {
      if (m.content) events.push({ kind: "assistant", text: m.content });
      const calls = (m.toolCalls ?? []) as {
        id: string;
        function: { name: string; arguments: string };
      }[];
      for (const tc of calls) {
        let args: Record<string, unknown> = {};
        try {
          args = tc.function.arguments
            ? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
            : {};
        } catch {
          // malformed args from the model — render as empty
        }
        events.push({
          kind: "tool_call",
          toolName: tc.function.name,
          toolArgs: args,
        });
      }
    } else if (m.role === "tool") {
      const result = (m.toolResult ?? {}) as {
        message?: string;
        data?: unknown;
        isError?: boolean;
      };
      events.push({
        kind: "tool_result",
        toolName: m.toolName ?? "",
        toolResult: { message: result.message ?? "", data: result.data },
        isError: !!result.isError,
      });
    }
  }
  return NextResponse.json({ conversationId, events });
}
