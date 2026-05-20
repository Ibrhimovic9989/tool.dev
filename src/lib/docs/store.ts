// Vector store backed by pgvector on Supabase.
//
// The public surface — addChunks / searchVectors / removeFile / listIndexedFiles
// / readVectors — is identical to the previous file-based implementation, so
// /api/docs/index, the MCP runtime, and the export pipeline don't need to
// change.

import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/db/client";
import { cosine } from "./embed";

export interface ChunkRecord {
  id: string;
  collectionId: string;
  fileId: string;
  fileName: string;
  text: string;
  source?: string;
  embedding: number[];
}

export interface ProjectVectors {
  version: 1;
  chunks: ChunkRecord[];
}

export interface SearchHit {
  chunk: ChunkRecord;
  score: number;
}

export async function addChunks(
  projectId: string,
  collectionId: string,
  fileName: string,
  fileId: string,
  chunks: { text: string; source?: string }[],
  embeddings: number[][],
): Promise<{ added: number }> {
  if (chunks.length !== embeddings.length) {
    throw new Error("chunks and embeddings count mismatch");
  }
  if (chunks.length === 0) return { added: 0 };
  const db = getDb();
  const rows = chunks.map((c, i) => ({
    id: `c_${nanoid(8)}`,
    projectId,
    collectionId,
    fileId,
    fileName,
    text: c.text,
    source: c.source ?? null,
    embedding: embeddings[i],
  }));
  // Drizzle handles vector binding via the pgvector column type.
  await db.insert(schema.vectorChunks).values(rows);
  return { added: rows.length };
}

export async function removeFile(
  projectId: string,
  fileId: string,
): Promise<{ removed: number }> {
  const db = getDb();
  const result = await db
    .delete(schema.vectorChunks)
    .where(
      and(
        eq(schema.vectorChunks.projectId, projectId),
        eq(schema.vectorChunks.fileId, fileId),
      ),
    );
  return { removed: result.rowCount ?? 0 };
}

/**
 * Cosine-similarity top-K over the HNSW index. pgvector's `<=>` operator
 * returns cosine *distance* (0 = identical, 2 = opposite), so we convert to
 * a similarity score (1 - distance) to keep parity with the previous API.
 */
export async function searchVectors(
  projectId: string,
  collectionId: string | null,
  queryEmbedding: number[],
  topK = 5,
  minScore = 0,
): Promise<SearchHit[]> {
  const db = getDb();
  const queryVector = toPgVectorLiteral(queryEmbedding);

  // Use a raw query — vector ops aren't first-class in the Drizzle DSL yet,
  // and a single SELECT is cleaner than chaining helpers.
  const rows = collectionId
    ? await db.execute<{
        id: string;
        project_id: string;
        collection_id: string;
        file_id: string;
        file_name: string;
        text: string;
        source: string | null;
        embedding: number[] | string;
        distance: number;
      }>(sql`
        SELECT id, project_id, collection_id, file_id, file_name, "text",
               "source", embedding,
               embedding <=> ${queryVector}::vector AS distance
        FROM vector_chunks
        WHERE project_id = ${projectId}
          AND collection_id = ${collectionId}
        ORDER BY embedding <=> ${queryVector}::vector
        LIMIT ${topK}
      `)
    : await db.execute<{
        id: string;
        project_id: string;
        collection_id: string;
        file_id: string;
        file_name: string;
        text: string;
        source: string | null;
        embedding: number[] | string;
        distance: number;
      }>(sql`
        SELECT id, project_id, collection_id, file_id, file_name, "text",
               "source", embedding,
               embedding <=> ${queryVector}::vector AS distance
        FROM vector_chunks
        WHERE project_id = ${projectId}
        ORDER BY embedding <=> ${queryVector}::vector
        LIMIT ${topK}
      `);

  const hits: SearchHit[] = rows.rows.map((r) => ({
    chunk: {
      id: r.id,
      collectionId: r.collection_id,
      fileId: r.file_id,
      fileName: r.file_name,
      text: r.text,
      source: r.source ?? undefined,
      // pgvector returns the column as either an array (newer drivers) or a
      // string like "[0.1, 0.2, ...]" — normalize lazily; consumers rarely
      // need the embedding back, and re-cosine'ing would double the work.
      embedding: Array.isArray(r.embedding)
        ? r.embedding
        : parsePgVectorString(r.embedding),
    },
    // pgvector's cosine distance is in [0, 2]. 1 - distance gives a [-1, 1]
    // similarity matching cosineSimilarity convention.
    score: 1 - Number(r.distance),
  }));
  return hits.filter((h) => h.score >= minScore);
}

export async function listIndexedFiles(
  projectId: string,
  collectionId?: string,
): Promise<{ fileId: string; fileName: string; chunks: number }[]> {
  const db = getDb();
  const rows = await db.execute<{ file_id: string; file_name: string; chunks: number }>(
    collectionId
      ? sql`
          SELECT file_id, file_name, COUNT(*)::int AS chunks
          FROM vector_chunks
          WHERE project_id = ${projectId}
            AND collection_id = ${collectionId}
          GROUP BY file_id, file_name
          ORDER BY MAX(created_at) DESC
        `
      : sql`
          SELECT file_id, file_name, COUNT(*)::int AS chunks
          FROM vector_chunks
          WHERE project_id = ${projectId}
          GROUP BY file_id, file_name
          ORDER BY MAX(created_at) DESC
        `,
  );
  return rows.rows.map((r) => ({
    fileId: r.file_id,
    fileName: r.file_name,
    chunks: r.chunks,
  }));
}

/**
 * Snapshot a project's entire vector store (chunks + embeddings).
 * Used by the export pipeline to bundle vectors into the downloaded zip.
 */
export async function readVectors(projectId: string): Promise<ProjectVectors> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.vectorChunks)
    .where(eq(schema.vectorChunks.projectId, projectId));
  return {
    version: 1,
    chunks: rows.map((r) => ({
      id: r.id,
      collectionId: r.collectionId,
      fileId: r.fileId,
      fileName: r.fileName,
      text: r.text,
      source: r.source ?? undefined,
      embedding: r.embedding as number[],
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// pgvector literal helpers
// ─────────────────────────────────────────────────────────────────────────────

function toPgVectorLiteral(v: number[]): string {
  // pgvector accepts text input like '[0.1, 0.2, ...]' and casts via ::vector.
  return "[" + v.join(",") + "]";
}

function parsePgVectorString(s: string | number[]): number[] {
  if (Array.isArray(s)) return s as number[];
  if (typeof s !== "string") return [];
  const trimmed = s.trim().replace(/^\[|\]$/g, "");
  if (!trimmed) return [];
  return trimmed.split(",").map(Number);
}

// Retain a defensive cosine helper for callers that still want to score
// in-process (none in the current codebase, but the export pipeline keeps the
// option open for offline reranking).
export { cosine };
