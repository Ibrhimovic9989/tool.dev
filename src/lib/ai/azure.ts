// Server-only Azure OpenAI helper. Used for plain-English -> graph and for
// generating friendly tool/resource descriptions for non-technical users.

import "server-only";

const ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const API_KEY = process.env.AZURE_OPENAI_API_KEY;
const DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-5.2-chat";
const API_VERSION =
  process.env.AZURE_OPENAI_API_VERSION ?? "2024-12-01-preview";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatOptions {
  /** Force JSON output for structured-output use-cases. */
  json?: boolean;
  /**
   * Sampling temperature. Note: some Azure deployments (e.g. GPT-5.2) reject
   * any non-default value, so this is omitted from the request entirely unless
   * explicitly provided.
   */
  temperature?: number;
}

export async function chat(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<string> {
  if (!ENDPOINT || !API_KEY) {
    throw new Error(
      "Azure OpenAI is not configured. Set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY in .env.local.",
    );
  }
  const url = `${ENDPOINT}/openai/deployments/${DEPLOYMENT}/chat/completions?api-version=${API_VERSION}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": API_KEY,
    },
    body: JSON.stringify({
      messages,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.json
        ? { response_format: { type: "json_object" } }
        : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Azure OpenAI error ${res.status}: ${text}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content ?? "";
}

export async function chatJSON<T>(
  messages: ChatMessage[],
  opts: Omit<ChatOptions, "json"> = {},
): Promise<T> {
  const text = await chat(messages, { ...opts, json: true });
  try {
    return JSON.parse(text) as T;
  } catch {
    // Best-effort recovery: find the first { ... } block
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as T;
    throw new Error("AI did not return valid JSON");
  }
}
