import { NextResponse } from "next/server";
import type { McpProject } from "@/lib/types";
import { savePublishedProject } from "@/lib/server/project-store";
import { auth } from "@/auth";

export const runtime = "nodejs";

/**
 * Publishes a project: persists the graph + on-device secrets to the server
 * store, returns the URL where the MCP HTTP transport is now live.
 *
 * The URL is derived from the incoming request's host so this works both
 * locally (http://localhost:3000) and in production (whatever origin
 * makemcp.dev is deployed at). No hardcoded "mcp.makemcp.dev".
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json(
      { error: "Sign in to publish a server." },
      { status: 401 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    project?: McpProject;
  };
  const project = body.project;
  if (!project) {
    return NextResponse.json({ error: "Missing project" }, { status: 400 });
  }
  const output = project.nodes.find((n) => n.data.kind === "output.mcp");
  if (!output || output.data.kind !== "output.mcp") {
    return NextResponse.json(
      { error: "Project has no MCP Server block. Drag one onto the canvas." },
      { status: 400 },
    );
  }
  const ready = project.nodes
    .filter((n) => n.data.kind !== "output.mcp")
    .every((n) => n.data.status === "ready");
  if (!ready) {
    return NextResponse.json(
      {
        error:
          "One or more blocks are still in draft. Open each block to finish configuring it.",
      },
      { status: 400 },
    );
  }

  try {
    await savePublishedProject(project, userId);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Couldn't save project" },
      { status: 500 },
    );
  }

  // Derive the URL from the request so it Just Works on localhost and prod.
  // Honour reverse-proxy headers in case the user is behind a load balancer.
  const proto =
    req.headers.get("x-forwarded-proto") ??
    (new URL(req.url).protocol === "https:" ? "https" : "http");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const origin = `${proto}://${host}`;
  const url = `${origin}/api/mcp/${output.data.slug}`;

  return NextResponse.json({
    url,
    slug: output.data.slug,
    visibility: output.data.visibility,
  });
}
