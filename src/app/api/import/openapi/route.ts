import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import type { RestEndpoint, RestParam } from "@/lib/types";
import { describeEndpoint } from "@/lib/ai/actions";

export const runtime = "nodejs";

interface OpenApiSpec {
  servers?: { url: string }[];
  paths?: Record<string, Record<string, OpenApiOperation>>;
}

interface OpenApiOperation {
  summary?: string;
  description?: string;
  parameters?: {
    name: string;
    in: string;
    required?: boolean;
    description?: string;
    schema?: { type?: string };
  }[];
  requestBody?: unknown;
}

const METHODS = ["get", "post", "put", "delete", "patch"] as const;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { url?: string };
  const url = body.url;
  if (!url) {
    return new NextResponse("Missing OpenAPI URL", { status: 400 });
  }

  let spec: OpenApiSpec;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Fetch returned ${res.status}`);
    spec = (await res.json()) as OpenApiSpec;
  } catch (e) {
    return new NextResponse(
      `Couldn't load that OpenAPI spec: ${e instanceof Error ? e.message : "unknown"}`,
      { status: 400 },
    );
  }

  const baseUrl = spec.servers?.[0]?.url ?? "";
  const endpoints: RestEndpoint[] = [];

  if (spec.paths) {
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const method of METHODS) {
        const op = methods[method];
        if (!op) continue;
        const parameters: RestParam[] = (op.parameters ?? []).map((p) => ({
          name: p.name,
          in: (p.in as RestParam["in"]) ?? "query",
          type: (p.schema?.type as RestParam["type"]) ?? "string",
          required: !!p.required,
          description: p.description ?? "",
        }));
        // Cap parallel AI calls to stay polite
        let toolName = synthesizeToolName(method, path);
        let description = op.summary ?? op.description ?? "";
        try {
          const ai = await describeEndpoint({
            method,
            path,
            summary: op.summary ?? op.description,
          });
          if (ai.toolName) toolName = ai.toolName;
          if (ai.description) description = ai.description;
        } catch {
          // AI is best-effort; keep the heuristics.
        }
        endpoints.push({
          id: nanoid(8),
          toolName,
          description,
          method: method.toUpperCase() as RestEndpoint["method"],
          path,
          parameters,
          enabled: true,
        });
      }
    }
  }

  return NextResponse.json({ baseUrl, endpoints });
}

function synthesizeToolName(method: string, path: string): string {
  // /citizens/{id} -> get_citizens_by_id
  const cleaned = path
    .replace(/\{([^}]+)\}/g, "by_$1")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
  const verb =
    method === "get"
      ? "get"
      : method === "post"
        ? "create"
        : method === "put" || method === "patch"
          ? "update"
          : method === "delete"
            ? "delete"
            : method;
  return `${verb}_${cleaned}`.slice(0, 60);
}
