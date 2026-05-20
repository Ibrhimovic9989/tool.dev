"use client";

import {
  Database,
  FileText,
  Globe,
  Plug,
  Server,
  CheckCircle2,
  CircleDashed,
  Sparkles,
  Copy,
} from "lucide-react";
import { useState } from "react";
import type { McpProject } from "@/lib/types";

const ICON = {
  "source.rest": Plug,
  "source.database": Database,
  "source.documents": FileText,
  "source.webpage": Globe,
  "output.mcp": Server,
} as const;

export function ProjectPreview({ project }: { project: McpProject | null }) {
  if (!project) {
    return (
      <main className="overflow-y-auto bg-[color:var(--color-ink-0)]">
        <div className="mx-auto grid h-full max-w-2xl place-items-center px-10 py-16 text-center">
          <div>
            <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full border border-[color:var(--color-ink-border)] bg-[color:var(--color-ink-1)]">
              <Sparkles className="size-5 text-[color:var(--color-accent-1)]" />
            </div>
            <p className="text-sm text-[color:var(--color-ink-text-2)] leading-relaxed">
              Your project preview appears here once the agent starts building.
              Sources, secrets, and the live MCP URL show up in real time.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const sources = project.nodes.filter((n) => n.data.kind !== "output.mcp");
  const output = project.nodes.find((n) => n.data.kind === "output.mcp");

  return (
    <main className="overflow-y-auto bg-[color:var(--color-ink-0)]">
      <div className="mx-auto max-w-3xl px-8 py-10 space-y-8">
        {/* Project header */}
        <header className="space-y-2">
          <span className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-ink-text-3)]">
            Project
          </span>
          <h1 className="text-2xl font-semibold tracking-tight text-[color:var(--color-ink-text-1)]">
            {project.name}
          </h1>
          {project.agency && (
            <p className="text-sm text-[color:var(--color-ink-text-2)]">
              {project.agency}
            </p>
          )}
          {project.description && (
            <p className="text-sm leading-relaxed text-[color:var(--color-ink-text-2)]">
              {project.description}
            </p>
          )}
        </header>

        <div className="noir-divider" />

        {/* Output / URL */}
        {output && output.data.kind === "output.mcp" && (
          <PublishCard slug={output.data.slug} transport={output.data.transport} visibility={output.data.visibility} />
        )}

        {/* Sources */}
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--color-ink-text-3)]">
              Sources
            </h2>
            <span className="font-mono text-[11px] text-[color:var(--color-ink-text-3)]">
              {sources.length}
            </span>
          </div>
          {sources.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[color:var(--color-ink-border)] bg-[color:var(--color-ink-1)] p-6 text-center text-xs text-[color:var(--color-ink-text-3)]">
              The agent hasn&apos;t attached any sources yet.
            </div>
          ) : (
            <ul className="space-y-2">
              {sources.map((n) => {
                const Icon = ICON[n.type] ?? Plug;
                return (
                  <li
                    key={n.id}
                    className="flex items-start gap-3 rounded-xl border border-[color:var(--color-ink-border)] bg-[color:var(--color-ink-1)] p-3.5"
                  >
                    <div className="grid size-8 place-items-center rounded-lg bg-[color:var(--color-ink-2)] text-[color:var(--color-accent-1)] shrink-0">
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-[color:var(--color-ink-text-1)]">
                          {n.data.name || "Untitled"}
                        </span>
                        <StatusChip status={n.data.status} />
                      </div>
                      <div className="mt-0.5 text-xs text-[color:var(--color-ink-text-3)] line-clamp-2">
                        {summary(n)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Secrets */}
        {Object.keys(project.secrets ?? {}).length > 0 && (
          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--color-ink-text-3)]">
                Saved secrets
              </h2>
              <span className="font-mono text-[11px] text-[color:var(--color-ink-text-3)]">
                {Object.keys(project.secrets).length}
              </span>
            </div>
            <div className="rounded-xl border border-[color:var(--color-ink-border)] bg-[color:var(--color-ink-1)] p-3 space-y-1.5">
              {Object.keys(project.secrets).map((k) => (
                <div
                  key={k}
                  className="flex items-center justify-between text-xs"
                >
                  <code className="font-mono text-[color:var(--color-ink-text-2)]">
                    {k}
                  </code>
                  <span className="font-mono text-[color:var(--color-ink-text-3)]">
                    ••••••
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function PublishCard({
  slug,
  transport,
  visibility,
}: {
  slug: string;
  transport: string;
  visibility: string;
}) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined"
    ? `${window.location.origin}/api/mcp/${slug}`
    : `/api/mcp/${slug}`;

  return (
    <section className="rounded-2xl border border-[color:var(--color-ink-border)] bg-gradient-to-br from-[color:var(--color-ink-1)] to-[color:var(--color-ink-2)] p-5 noir-grain">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[color:var(--color-ink-text-3)]">
        <Server className="size-3" />
        Live MCP endpoint
      </div>
      <div className="mt-2 flex items-center gap-2">
        <code className="flex-1 break-all rounded-lg border border-[color:var(--color-ink-border)] bg-[color:var(--color-ink-0)] px-3 py-2 font-mono text-[12.5px] text-[color:var(--color-ink-text-1)]">
          {url}
        </code>
        <button
          onClick={() => {
            navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }}
          className="noir-btn-ghost"
        >
          <Copy className="size-3" />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-[color:var(--color-ink-text-3)]">
        {visibility === "public" ? "Public" : "Private"} · {transport} transport
      </p>
    </section>
  );
}

function StatusChip({ status }: { status: "draft" | "ready" | "error" }) {
  if (status === "ready") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[oklch(0.25_0.08_155)] px-2 py-0.5 text-[10px] font-medium text-[oklch(0.85_0.12_155)]">
        <CheckCircle2 className="size-2.5" />
        Ready
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[oklch(0.28_0.10_25)] px-2 py-0.5 text-[10px] font-medium text-[oklch(0.85_0.12_25)]">
        Fix
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--color-ink-border)] bg-[color:var(--color-ink-2)] px-2 py-0.5 text-[10px] text-[color:var(--color-ink-text-3)]">
      <CircleDashed className="size-2.5" />
      Draft
    </span>
  );
}

function summary(n: McpProject["nodes"][number]): string {
  switch (n.data.kind) {
    case "source.rest":
      return n.data.baseUrl
        ? `${n.data.endpoints.length} endpoint${n.data.endpoints.length === 1 ? "" : "s"} · ${n.data.baseUrl}`
        : "Awaiting base URL";
    case "source.database":
      return n.data.host
        ? `${n.data.engine} · ${n.data.host} · ${n.data.tables.length} table${n.data.tables.length === 1 ? "" : "s"}`
        : "Awaiting connection";
    case "source.documents":
      return n.data.collections.length
        ? `${n.data.collections.length} collection${n.data.collections.length === 1 ? "" : "s"}`
        : "No documents yet";
    case "source.webpage":
      return n.data.targets.length
        ? `${n.data.targets.length} page${n.data.targets.length === 1 ? "" : "s"}`
        : "Awaiting URL";
    default:
      return "";
  }
}
