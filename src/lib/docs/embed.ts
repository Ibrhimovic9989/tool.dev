// Azure OpenAI embeddings client. Uses the deployment configured in
// AZURE_OPENAI_EMBEDDING_DEPLOYMENT (text-embedding-3-small in our case).
//
// One request per batch of inputs; Azure caps batch sizes at 2048 inputs and
// 8191 tokens per input for text-embedding-3-small. We don't enforce that
// here — the chunking step keeps each chunk well under the token limit.

import "server-only";

const ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const KEY = process.env.AZURE_OPENAI_API_KEY;
const DEPLOYMENT = process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT;
const API_VERSION =
  process.env.AZURE_OPENAI_API_VERSION ?? "2024-12-01-preview";

export async function embedBatch(inputs: string[]): Promise<number[][]> {
  if (!ENDPOINT || !KEY || !DEPLOYMENT) {
    throw new Error(
      "Embeddings not configured. Set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_EMBEDDING_DEPLOYMENT.",
    );
  }
  if (inputs.length === 0) return [];
  const url = `${ENDPOINT}/openai/deployments/${DEPLOYMENT}/embeddings?api-version=${API_VERSION}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": KEY },
    body: JSON.stringify({ input: inputs }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Embeddings error ${res.status}: ${t}`);
  }
  const json = (await res.json()) as {
    data: { embedding: number[]; index: number }[];
  };
  // Sort by index to keep alignment with `inputs` order.
  return json.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

export async function embedOne(input: string): Promise<number[]> {
  const [v] = await embedBatch([input]);
  return v;
}

export function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
