import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { extractText } from "@/lib/docs/extract";
import { chunkText } from "@/lib/docs/chunk";
import { embedBatch } from "@/lib/docs/embed";
import { addChunks } from "@/lib/docs/store";

export const runtime = "nodejs";
// PDFs + OCR + embeddings can take a moment; the default 30s isn't enough.
export const maxDuration = 300;

/**
 * Multipart upload: indexes a single file into a project's vector store.
 *
 * Form fields:
 *   - projectId        (string, required) — used as the vector-store key
 *   - collectionId     (string, required) — the Documents node collection
 *   - file             (File, required)   — the document to index
 *
 * Returns JSON:
 *   { fileId, fileName, chunks, tokensApprox, strategy }
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }
  const projectId = String(form.get("projectId") ?? "");
  const collectionId = String(form.get("collectionId") ?? "");
  const file = form.get("file");
  if (!projectId || !collectionId) {
    return NextResponse.json(
      { error: "projectId and collectionId are required" },
      { status: 400 },
    );
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (file.size > 25 * 1024 * 1024) {
    return NextResponse.json(
      { error: "File too large (limit 25 MB in this build)" },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let extracted;
  try {
    extracted = await extractText(buffer, file.name, file.type);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Couldn't extract text" },
      { status: 400 },
    );
  }

  const chunks = chunkText(extracted.text, file.name);
  if (chunks.length === 0) {
    return NextResponse.json({
      fileId: `f_${nanoid(8)}`,
      fileName: file.name,
      chunks: 0,
      tokensApprox: 0,
      strategy: extracted.strategy,
      note: "No usable text extracted",
    });
  }

  let embeddings: number[][];
  try {
    // Azure caps inputs per call; batch in groups of 16 to be safe.
    embeddings = [];
    const BATCH = 16;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH).map((c) => c.text);
      const vectors = await embedBatch(batch);
      embeddings.push(...vectors);
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Embeddings failed" },
      { status: 500 },
    );
  }

  const fileId = `f_${nanoid(8)}`;
  await addChunks(projectId, collectionId, file.name, fileId, chunks, embeddings);
  // ~4 chars per token is a rough heuristic; good enough for UI display.
  const tokensApprox = Math.round(
    chunks.reduce((n, c) => n + c.text.length, 0) / 4,
  );
  return NextResponse.json({
    fileId,
    fileName: file.name,
    chunks: chunks.length,
    tokensApprox,
    strategy: extracted.strategy,
  });
}
