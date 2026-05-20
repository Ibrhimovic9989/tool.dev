import { NextResponse } from "next/server";
import JSZip from "jszip";
import type { McpProject } from "@/lib/types";
import { generateServerFiles } from "@/lib/generators/server-generator";
import { readVectors } from "@/lib/docs/store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { project?: McpProject; includeSecrets?: boolean };
  try {
    body = (await req.json()) as {
      project?: McpProject;
      includeSecrets?: boolean;
    };
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }
  const project = body.project;
  if (!project || !project.id || !Array.isArray(project.nodes)) {
    return new NextResponse("Missing or malformed project", { status: 400 });
  }

  // Pull the project's vector store off disk; if there are no documents nodes
  // at all the file won't exist and readVectors returns an empty record, which
  // the generator handles by skipping doc support entirely.
  const vectors = await readVectors(project.id).catch(() => null);
  const hasAnyChunks = !!vectors && vectors.chunks.length > 0;

  const files = generateServerFiles(project, {
    bakedSecrets:
      body.includeSecrets && project.secrets && Object.keys(project.secrets).length
        ? project.secrets
        : undefined,
    vectors: hasAnyChunks ? vectors : undefined,
  });
  const zip = new JSZip();
  for (const f of files) {
    zip.file(f.path, f.content);
  }
  const buffer = await zip.generateAsync({ type: "uint8array" });

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${slugify(project.name)}-mcp.zip"`,
    },
  });
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "mcp-server"
  );
}
