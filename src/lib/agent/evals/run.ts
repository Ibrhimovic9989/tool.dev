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
import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/db/client";
import { runAgentTurn } from "@/lib/agent/harness";
import { listTools as runtimeListTools } from "@/lib/server/mcp-runtime";
import {
  getProject,
  createProject,
  saveProject,
} from "@/lib/server/projects-service";
import { createNode } from "@/lib/factory";
import type { DocumentsSourceData } from "@/lib/types";
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

/**
 * Seed a project that already has a Documents source with a chat_uploads
 * collection. Optionally inserts fake indexed vector chunks so health checks
 * see "files indexed".
 */
async function seedDocumentsProject(opts: {
  withIndexedFiles: boolean;
  projectName: string;
}): Promise<string> {
  const project = await createProject(
    { userId: EVAL_USER_ID },
    opts.projectName,
  );
  const docNode = createNode("source.documents", { x: 240, y: 360 });
  const data = docNode.data as DocumentsSourceData & {
    kind: "source.documents";
  };
  data.collections = [
    {
      id: nanoid(8),
      resourceName: "chat_uploads",
      description: "Documents you attached in chat",
      files: opts.withIndexedFiles
        ? [
            { name: "policy_a.pdf", size: 100_000, mime: "application/pdf" },
            { name: "policy_b.pdf", size: 100_000, mime: "application/pdf" },
          ]
        : [],
      chunkSize: 1000,
      enabled: true,
    },
  ];
  data.status = opts.withIndexedFiles ? "ready" : "draft";
  project.nodes.push(docNode);
  await saveProject({ userId: EVAL_USER_ID }, project); // autoWireToOutput adds the edge

  if (opts.withIndexedFiles) {
    const db = getDb();
    const collectionId = data.collections[0].id;
    // Fake embeddings (1536-dim, all zeros) — pgvector accepts them; we
    // never query similarity in fixtures, only count `files` and the
    // health-check's listIndexedFiles().
    const zeros = "[" + new Array(1536).fill(0).join(",") + "]";
    for (const fileName of ["policy_a.pdf", "policy_b.pdf"]) {
      const fileId = `f_eval_${nanoid(6)}`;
      for (let i = 0; i < 3; i++) {
        await db.execute(
          sql`INSERT INTO vector_chunks (id, project_id, collection_id, file_id, file_name, text, embedding)
              VALUES (${`c_eval_${nanoid(8)}`}, ${project.id}, ${collectionId}, ${fileId}, ${fileName},
                      ${"chunk " + i + " of " + fileName}, ${zeros}::vector)`,
        );
      }
    }
  }
  return project.id;
}

async function runFixture(fx: Fixture): Promise<FixtureResult> {
  const db = getDb();
  const failures: string[] = [];
  const conversationId = `c_eval_${nanoid(10)}`;

  // Per-fixture seeding. The agent should see the project state injected
  // into its system prompt and behave accordingly.
  let projectId: string | null = null;
  if (fx.id === "second_turn_must_not_recreate") {
    const p = await createProject(
      { userId: EVAL_USER_ID },
      "Eval continuity project",
    );
    projectId = p.id;
  } else if (fx.id === "publish_with_known_blocker") {
    projectId = await seedDocumentsProject({
      withIndexedFiles: false,
      projectName: "Eval blocker project",
    });
  } else if (fx.id === "drop_files_in_chat") {
    projectId = await seedDocumentsProject({
      withIndexedFiles: true,
      projectName: "Eval chat-uploads project",
    });
  } else if (fx.id === "edge_rename_request") {
    // "Rename my project" needs an existing project to rename. With one
    // seeded, create_project gets filtered out of the catalog, and we
    // can test that the agent doesn't try to mutate via other tools.
    const p = await createProject(
      { userId: EVAL_USER_ID },
      "Existing project",
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

  // Cleanup. Order matters: messages/conversations FK to users; vector
  // chunks reference projects by id (no FK, manual cleanup needed).
  await db
    .delete(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId));
  await db
    .delete(schema.conversations)
    .where(eq(schema.conversations.id, conversationId));
  // Delete vector_chunks for both the seeded project (if any) and any
  // project the agent created mid-turn.
  const projectsToWipe = new Set<string>();
  if (projectId) projectsToWipe.add(projectId);
  if (result.currentProjectId) projectsToWipe.add(result.currentProjectId);
  for (const pid of projectsToWipe) {
    await db
      .delete(schema.vectorChunks)
      .where(eq(schema.vectorChunks.projectId, pid));
    await db.delete(schema.projects).where(eq(schema.projects.id, pid));
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
  const runs = Math.max(1, Number(process.env.EVAL_RUNS ?? 1));
  console.log(
    `Running ${subset.length} fixture(s)${runs > 1 ? ` × ${runs} runs` : ""}...\n`,
  );

  // Per-fixture stats across all runs.
  const stats = new Map<
    string,
    { passes: number; turns: number[]; lastFailures: string[] }
  >();
  for (const fx of subset) stats.set(fx.id, { passes: 0, turns: [], lastFailures: [] });

  const allResults: FixtureResult[] = [];

  for (let r = 0; r < runs; r++) {
    if (runs > 1) console.log(`--- run ${r + 1}/${runs} ---`);
    for (const fx of subset) {
      process.stdout.write(`  ${fx.id.padEnd(40)} `);
      let result: FixtureResult;
      try {
        result = await runFixture(fx);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result = {
          id: fx.id,
          pass: false,
          turns: 0,
          toolCount: 0,
          failures: [`runtime error: ${msg}`],
        };
      }
      allResults.push(result);
      const s = stats.get(fx.id)!;
      if (result.pass) s.passes++;
      s.turns.push(result.turns);
      if (!result.pass) s.lastFailures = result.failures;
      const status = result.pass ? "PASS" : "FAIL";
      process.stdout.write(
        `${status}  turns=${result.turns} tools=${result.toolCount}${
          result.failures.length ? " :: " + result.failures.join("; ") : ""
        }\n`,
      );
    }
  }

  // Summary
  if (runs > 1) {
    console.log("\n=== Per-fixture summary across runs ===");
    for (const fx of subset) {
      const s = stats.get(fx.id)!;
      const mean = s.turns.reduce((a, b) => a + b, 0) / s.turns.length;
      const min = Math.min(...s.turns);
      const max = Math.max(...s.turns);
      const passRate = `${s.passes}/${runs}`;
      const stable = s.passes === 0 || s.passes === runs ? "" : " (FLAKY)";
      console.log(
        `  ${fx.id.padEnd(40)} ${passRate.padStart(5)}  turns=${mean.toFixed(1)} [${min}-${max}]${stable}${
          s.lastFailures.length ? " :: " + s.lastFailures.join("; ") : ""
        }`,
      );
    }
  }

  const passed = allResults.filter((r) => r.pass).length;
  const meanTurns =
    allResults.reduce((sum, r) => sum + r.turns, 0) / allResults.length;
  console.log(
    `\n${passed}/${allResults.length} pass  mean_turns=${meanTurns.toFixed(2)}`,
  );
  process.exit(passed === allResults.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
