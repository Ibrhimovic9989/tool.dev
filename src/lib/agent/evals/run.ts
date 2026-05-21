/**
 * Eval runner — replays each fixture through the full agent harness and
 * scores the result.
 *
 * Invoked via `npm run eval` (see package.json). Reads DATABASE_URL +
 * AZURE_* env vars from .env, runs against a real Azure deployment and a
 * real Supabase row per fixture (cleaned up after), so the numbers reflect
 * what production actually does.
 *
 * Output: a pass/fail line per fixture and a summary line. Non-zero exit
 * if anything failed — wires into CI later.
 */

import "dotenv/config";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/db/client";
import { runAgentTurn } from "@/lib/agent/harness";
import { listTools as runtimeListTools } from "@/lib/server/mcp-runtime";
import { getProject, createProject } from "@/lib/server/projects-service";
import { FIXTURES, type Fixture } from "./fixtures";

interface FixtureResult {
  id: string;
  pass: boolean;
  turns: number;
  toolCount: number;
  failures: string[];
}

const EVAL_USER_ID =
  process.env.EVAL_USER_ID ??
  // Falls back to a sentinel; the eval row is cleaned up at the end either way.
  "00000000-0000-0000-0000-000000000000";

async function runFixture(fx: Fixture): Promise<FixtureResult> {
  const db = getDb();
  const failures: string[] = [];
  const conversationId = `c_eval_${nanoid(10)}`;

  // For continuity fixtures, seed a project + conversation FIRST so the
  // turn sees existing state.
  let projectId: string | null = null;
  if (fx.id === "second_turn_must_not_recreate") {
    const p = await createProject(
      { userId: EVAL_USER_ID },
      "Eval continuity project",
    );
    projectId = p.id;
  }

  await db.insert(schema.conversations).values({
    id: conversationId,
    userId: EVAL_USER_ID,
    projectId,
    title: fx.userMessage.slice(0, 60),
  });

  const result = await runAgentTurn({
    userId: EVAL_USER_ID,
    conversationId,
    userMessage: fx.userMessage,
    currentProjectId: projectId,
  });

  const turns = result.events.filter((e) => e.kind === "tool_call").length;
  const toolCalls = new Set(
    result.events
      .filter((e) => e.kind === "tool_call")
      .map((e) => e.toolName ?? ""),
  );
  const finalProject = result.currentProjectId
    ? await getProject({ userId: EVAL_USER_ID }, result.currentProjectId)
    : null;
  const toolCount = finalProject ? runtimeListTools(finalProject).length : 0;

  if (fx.expect.maxTurns !== undefined && turns > fx.expect.maxTurns) {
    failures.push(`turns=${turns} > maxTurns=${fx.expect.maxTurns}`);
  }
  for (const t of fx.expect.mustCall ?? []) {
    if (!toolCalls.has(t)) failures.push(`mustCall missing: ${t}`);
  }
  for (const t of fx.expect.mustNotCall ?? []) {
    if (toolCalls.has(t)) failures.push(`mustNotCall violated: ${t}`);
  }
  if (fx.expect.sourceKinds && finalProject) {
    for (const want of fx.expect.sourceKinds) {
      if (!finalProject.nodes.some((n) => n.data.kind === want)) {
        failures.push(`expected source kind: ${want}`);
      }
    }
  }
  if (fx.expect.minTools !== undefined && toolCount < fx.expect.minTools) {
    failures.push(`toolCount=${toolCount} < minTools=${fx.expect.minTools}`);
  }
  if (fx.expect.forbidPublish && toolCalls.has("publish_project")) {
    // Publish is forbidden only if it succeeded (non-error) — but the agent
    // calling it and getting refused server-side is still wrong from a UX POV.
    failures.push("called publish_project when forbidden");
  }
  if (fx.expect.expectClarifyingQuestion) {
    const lastAssistant = [...result.events]
      .reverse()
      .find((e) => e.kind === "assistant")?.text;
    if (!lastAssistant?.includes("?")) {
      failures.push("expected a clarifying question, got none");
    }
  }

  // Cleanup
  await db
    .delete(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId));
  await db
    .delete(schema.conversations)
    .where(eq(schema.conversations.id, conversationId));
  if (result.currentProjectId) {
    await db
      .delete(schema.projects)
      .where(eq(schema.projects.id, result.currentProjectId));
  }

  return {
    id: fx.id,
    pass: failures.length === 0,
    turns,
    toolCount,
    failures,
  };
}

async function main() {
  const filter = process.argv[2]; // optional substring filter for ids
  const subset = filter
    ? FIXTURES.filter((f) => f.id.includes(filter))
    : FIXTURES;
  if (subset.length === 0) {
    console.error(`No fixtures match "${filter}".`);
    process.exit(2);
  }
  console.log(`Running ${subset.length} fixture(s)...\n`);

  const results: FixtureResult[] = [];
  for (const fx of subset) {
    process.stdout.write(`  ${fx.id.padEnd(40)} `);
    try {
      const r = await runFixture(fx);
      results.push(r);
      const status = r.pass ? "PASS" : "FAIL";
      process.stdout.write(
        `${status}  turns=${r.turns} tools=${r.toolCount}${
          r.failures.length ? " :: " + r.failures.join("; ") : ""
        }\n`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({
        id: fx.id,
        pass: false,
        turns: 0,
        toolCount: 0,
        failures: [`runtime error: ${msg}`],
      });
      process.stdout.write(`ERROR  ${msg}\n`);
    }
  }

  const passed = results.filter((r) => r.pass).length;
  const meanTurns =
    results.reduce((sum, r) => sum + r.turns, 0) / results.length;
  console.log(
    `\n${passed}/${results.length} pass  mean_turns=${meanTurns.toFixed(2)}`,
  );
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
