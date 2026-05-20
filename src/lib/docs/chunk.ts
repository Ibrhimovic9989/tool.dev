// Naive but effective chunking: split on double newlines first (preserves
// paragraph boundaries), then bin paragraphs into ~`targetChars` chunks. For
// very long single paragraphs (e.g. PDF without proper line breaks), fall
// back to a sliding window over sentences.
//
// We measure in characters rather than tokens because (a) embeddings are
// generous on token limits and (b) we don't want to add a tokenizer
// dependency. text-embedding-3-small takes 8191 tokens ≈ ~30k chars, so
// targeting 1200 chars per chunk is comfortably under.

export interface Chunk {
  text: string;
  /** Optional source hint preserved through indexing (e.g. "page 3") */
  source?: string;
}

const TARGET_CHARS = 1200;
const OVERLAP_CHARS = 150;

export function chunkText(input: string, hint?: string): Chunk[] {
  const normalized = input.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  // First pass: paragraph splits
  const paras = normalized
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: Chunk[] = [];
  let buf = "";
  for (const p of paras) {
    // A single paragraph longer than the target — slice it with overlap.
    if (p.length > TARGET_CHARS) {
      flush();
      let i = 0;
      while (i < p.length) {
        const slice = p.slice(i, i + TARGET_CHARS);
        chunks.push({ text: slice, source: hint });
        if (i + TARGET_CHARS >= p.length) break;
        i += TARGET_CHARS - OVERLAP_CHARS;
      }
      continue;
    }
    if (buf.length + p.length + 2 > TARGET_CHARS) {
      flush();
    }
    buf = buf ? `${buf}\n\n${p}` : p;
  }
  flush();
  return chunks;

  function flush() {
    if (buf.trim()) chunks.push({ text: buf, source: hint });
    buf = "";
  }
}
