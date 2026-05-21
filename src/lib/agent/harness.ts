// Agent harness: one entry point per user turn.
//
//   loadHistory()  →  modelCall()  →  any tool calls? →  yes → execute, append, loop
//                                                 ↓
//                                              no → save + return
//
// Memory lives in `messages`; the orchestrator is whatever invokes this
// (currently /api/agent/turn). Iteration is capped so a misbehaving model
// can't run wild.

import "server-only";
import { eq, asc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/db/client";
import { TOOLS, runTool, type ToolContext } from "./tools";
import { getProject } from "@/lib/server/projects-service";
import type { McpProject } from "@/lib/types";

const ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const KEY = process.env.AZURE_OPENAI_API_KEY;
const DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-5.2-chat";
const API_VERSION =
  process.env.AZURE_OPENAI_API_VERSION ?? "2024-12-01-preview";

const MAX_ITERATIONS = 6;

const SYSTEM_PROMPT = `You are makemcp.dev's onboarding agent. You build MCP (Model Context Protocol) servers on behalf of non-technical government and SaaS users.

You drive a project state by calling tools.

Project context rules — read carefully:
- If a "Current project" block is present below, that is the ACTIVE project. NEVER call create_project in that case; just modify it.
- Only call create_project when there is NO current project AND the user is starting fresh.
- If the user has uploaded files in chat (look for an existing source.documents node with a 'chat_uploads' collection), DO NOT add another documents source — the files are already indexed. Just confirm and continue.

Publishing rules (this is where agents most often "declare victory too early" — do not):
- BEFORE calling publish_project, ALWAYS call check_project_health first. The report tells you exactly which sources are wired, how many tools the MCP currently exposes, and what issues block a useful publish.
- If check_project_health returns issues, fix them (or tell the user what they need to provide) BEFORE attempting publish.
- A publish that exposes zero tools is a FAILURE, not a success. The publish_project tool will refuse in that case; treat the refusal as the truth and act on it instead of retrying.

General rules:
- Be conservative: prefer a tight, working setup (one DB or one API plus discovery) over a sprawling one.
- After adding a database, run discover_database_tables in the same turn.
- Never invent credentials. If the user hasn't given them, ask once and stop.
- Publish only when the user explicitly asks, or when every source is ready and the user has confirmed.
- Reply to the user in plain language. Don't echo connection strings or passwords back at them.
- Users CAN drag-and-drop files directly into the chat. Don't tell them they have to use a separate panel.

Tool calls are server-executed and the results are visible to you. The user sees a separate canvas reflecting the current project. Keep your final text replies short — the canvas already shows what changed.`;

function summarizeProject(project: McpProject): string {
  const lines: string[] = [];
  lines.push(`Current project: "${project.name}" (id=${project.id})`);
  if (project.agency) lines.push(`Agency: ${project.agency}`);
  if (project.description) lines.push(`Purpose: ${project.description}`);
  const sources = project.nodes.filter((n) => n.data.kind !== "output.mcp");
  if (sources.length === 0) {
    lines.push("Sources: (none yet — add one before publishing)");
  } else {
    lines.push(`Sources (${sources.length}):`);
    for (const n of sources) {
      const d = n.data;
      if (d.kind === "source.documents") {
        const cols = d.collections
          .map((c) => `${c.resourceName}(${c.files.length} files)`)
          .join(", ");
        lines.push(`  - documents '${d.name}': ${cols || "no collections"} [status=${d.status}]`);
      } else if (d.kind === "source.database") {
        lines.push(
          `  - database '${d.name}': ${d.host}/${d.database}, ${d.tables.filter((t) => t.enabled).length} tables [status=${d.status}]`,
        );
      } else if (d.kind === "source.rest") {
        lines.push(
          `  - rest '${d.name}': ${d.baseUrl}, ${d.endpoints.filter((e) => e.enabled).length} endpoints [status=${d.status}]`,
        );
      } else if (d.kind === "source.webpage") {
        lines.push(
          `  - webpage '${d.name}': ${d.targets.filter((t) => t.enabled).length} targets [status=${d.status}]`,
        );
      }
    }
  }
  const output = project.nodes.find((n) => n.data.kind === "output.mcp");
  if (output && output.data.kind === "output.mcp") {
    lines.push(`Output slug: ${output.data.slug} (status=${output.data.status})`);
  }
  return lines.join("\n");
}

type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export interface AgentTurnInput {
  userId: string;
  conversationId: string;
  /** Plain text the user typed */
  userMessage: string;
  /** Project the agent currently operates on (NULL = let the agent create one). */
  currentProjectId: string | null;
}

export interface AgentEvent {
  kind: "assistant" | "tool_call" | "tool_result" | "error";
  text?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: Record<string, unknown>;
  isError?: boolean;
}

export interface AgentTurnOutput {
  events: AgentEvent[];
  /** Final project id the agent settled on (creates one if it didn't exist). */
  currentProjectId: string | null;
  /** True if a tool mutated the project — the client should refetch. */
  projectChanged: boolean;
}

export async function runAgentTurn(
  input: AgentTurnInput,
): Promise<AgentTurnOutput> {
  if (!ENDPOINT || !KEY) {
    throw new Error(
      "Azure OpenAI is not configured (AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_API_KEY).",
    );
  }
  const db = getDb();

  // 1) Persist the user message immediately so even crashes leave a trail.
  await db.insert(schema.messages).values({
    id: `m_${nanoid(10)}`,
    conversationId: input.conversationId,
    role: "user",
    content: input.userMessage,
  });

  // 2) Rebuild OpenAI-style messages from history.
  const history = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, input.conversationId))
    .orderBy(asc(schema.messages.createdAt));

  // If we already have a current project, dump its current state into the
  // system message so the model doesn't try to re-create it from scratch.
  let systemContent = SYSTEM_PROMPT;
  if (input.currentProjectId) {
    const current = await getProject(
      { userId: input.userId },
      input.currentProjectId,
    ).catch(() => null);
    if (current) {
      systemContent += `\n\n--- Active project state ---\n${summarizeProject(current)}\n--- end ---`;
    }
  }

  const wire: ChatMessage[] = [{ role: "system", content: systemContent }];
  for (const m of history) {
    if (m.role === "user") {
      wire.push({ role: "user", content: m.content ?? "" });
    } else if (m.role === "assistant") {
      wire.push({
        role: "assistant",
        content: m.content,
        tool_calls: (m.toolCalls as ChatMessage extends {
          role: "assistant";
          tool_calls?: infer T;
        }
          ? T
          : undefined) ?? undefined,
      });
    } else if (m.role === "tool") {
      wire.push({
        role: "tool",
        tool_call_id: m.toolCallId ?? "",
        content:
          typeof m.toolResult === "string"
            ? m.toolResult
            : JSON.stringify(m.toolResult ?? {}),
      });
    }
  }

  const events: AgentEvent[] = [];
  const ctx: ToolContext = {
    userId: input.userId,
    currentProjectId: input.currentProjectId,
  };
  let projectChanged = false;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const reply = await callModel(wire);
    // Persist assistant turn (may be tool-call-only with empty content).
    await db.insert(schema.messages).values({
      id: `m_${nanoid(10)}`,
      conversationId: input.conversationId,
      role: "assistant",
      content: reply.content,
      toolCalls: reply.tool_calls ?? null,
    });
    if (reply.content) {
      events.push({ kind: "assistant", text: reply.content });
    }
    if (!reply.tool_calls || reply.tool_calls.length === 0) {
      // Plain assistant reply — turn is done.
      break;
    }

    // Append the assistant tool-calling turn into wire so the next call
    // sees its own request.
    wire.push({
      role: "assistant",
      content: reply.content,
      tool_calls: reply.tool_calls,
    });

    // Execute each tool call in order; each result feeds the next iteration.
    for (const tc of reply.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = tc.function.arguments
          ? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
          : {};
      } catch {
        // The model can occasionally emit malformed JSON; surface that.
        args = {};
      }
      events.push({ kind: "tool_call", toolName: tc.function.name, toolArgs: args });

      const result = await runTool(ctx, tc.function.name, args);
      if (result.newCurrentProjectId) ctx.currentProjectId = result.newCurrentProjectId;
      if (result.projectUpdated) projectChanged = true;

      events.push({
        kind: "tool_result",
        toolName: tc.function.name,
        toolResult: { message: result.message, data: result.data ?? null },
        isError: result.isError,
      });

      // Persist the tool response.
      await db.insert(schema.messages).values({
        id: `m_${nanoid(10)}`,
        conversationId: input.conversationId,
        role: "tool",
        toolCallId: tc.id,
        toolName: tc.function.name,
        toolArgs: args,
        toolResult: { message: result.message, data: result.data ?? null, isError: !!result.isError },
      });

      wire.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify({
          message: result.message,
          data: result.data ?? null,
          isError: !!result.isError,
        }),
      });
    }
  }

  // Bump the conversation's updated_at so it sorts to the top.
  await db
    .update(schema.conversations)
    .set({
      updatedAt: new Date(),
      projectId: ctx.currentProjectId,
    })
    .where(eq(schema.conversations.id, input.conversationId));

  return {
    events,
    currentProjectId: ctx.currentProjectId,
    projectChanged,
  };
}

// ─── Model call (Azure OpenAI chat.completions with function calling) ──────

interface ModelReply {
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
}

async function callModel(messages: ChatMessage[]): Promise<ModelReply> {
  const url = `${ENDPOINT}/openai/deployments/${DEPLOYMENT}/chat/completions?api-version=${API_VERSION}`;
  const tools = TOOLS.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": KEY! },
    body: JSON.stringify({ messages, tools, tool_choice: "auto" }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Model error ${res.status}: ${t}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: ModelReply }[];
  };
  const msg = json.choices?.[0]?.message;
  if (!msg) throw new Error("Empty model reply");
  return { content: msg.content ?? null, tool_calls: msg.tool_calls };
}
