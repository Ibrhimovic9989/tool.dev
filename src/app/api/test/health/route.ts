import { NextResponse } from "next/server";
import type { McpProject, McpNode } from "@/lib/types";
import { withPgClient, fromDbSource } from "@/lib/db/pg-client";

export const runtime = "nodejs";
export const maxDuration = 20;

/**
 * Quick reachability check per source node — pings the configured target
 * without invoking any specific tool. Useful as a green/red dot in the test UI.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    project?: McpProject;
    nodeId?: string;
    /** Optional one-shot secrets, keyed by env var name. */
    secrets?: Record<string, string>;
  };
  const { project, nodeId } = body;
  const node = project?.nodes?.find((n: McpNode) => n.id === nodeId);
  if (!node) {
    return NextResponse.json({ error: "Node not found" }, { status: 404 });
  }

  const start = Date.now();
  try {
    switch (node.data.kind) {
      case "source.rest": {
        if (!node.data.baseUrl) {
          return NextResponse.json({
            ok: false,
            message: "No base URL configured",
          });
        }
        const res = await fetch(node.data.baseUrl, { method: "HEAD" });
        return NextResponse.json({
          ok: res.ok || res.status === 405 || res.status === 404,
          status: res.status,
          durationMs: Date.now() - start,
          message: `HEAD ${node.data.baseUrl} → ${res.status}`,
        });
      }
      case "source.webpage": {
        const t = node.data.targets[0];
        if (!t?.url) {
          return NextResponse.json({
            ok: false,
            message: "No URLs configured",
          });
        }
        const res = await fetch(t.url, { method: "HEAD" });
        return NextResponse.json({
          ok: res.ok,
          status: res.status,
          durationMs: Date.now() - start,
          message: `HEAD ${t.url} → ${res.status}`,
        });
      }
      case "source.documents": {
        const total = node.data.collections.reduce(
          (n, c) => n + c.files.length,
          0,
        );
        return NextResponse.json({
          ok: total > 0 || node.data.collections.some((c) => c.sourceLocation),
          durationMs: Date.now() - start,
          message: `${node.data.collections.length} collections, ${total} files`,
        });
      }
      case "source.database": {
        if (node.data.engine !== "postgres") {
          return NextResponse.json({
            ok: !!node.data.host && !!node.data.database,
            durationMs: Date.now() - start,
            message:
              "MySQL/SQL Server checks require the downloaded smoke test. Postgres works in-builder.",
          });
        }
        const password = body.secrets?.[node.data.passwordEnvVar];
        if (!password) {
          return NextResponse.json({
            ok: !!node.data.host && !!node.data.database && !!node.data.username,
            durationMs: Date.now() - start,
            message: "Fields look set. Add the password in the test panel to run a live connection check.",
          });
        }
        try {
          const rows = await withPgClient(
            fromDbSource(node.data, password),
            (q) => q<{ now: string }>("SELECT NOW() AS now"),
          );
          return NextResponse.json({
            ok: true,
            durationMs: Date.now() - start,
            message: `Connected. Server time: ${rows[0]?.now}`,
          });
        } catch (e) {
          return NextResponse.json({
            ok: false,
            durationMs: Date.now() - start,
            message: e instanceof Error ? e.message : "Couldn't connect",
          });
        }
      }
      default:
        return NextResponse.json({
          ok: true,
          message: "No connectivity check for this node type",
        });
    }
  } catch (e) {
    return NextResponse.json({
      ok: false,
      durationMs: Date.now() - start,
      message: e instanceof Error ? e.message : "Unknown error",
    });
  }
}
