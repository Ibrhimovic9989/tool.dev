"use client";

import { Sparkles } from "lucide-react";
import { AgentCanvas } from "./agent-canvas";
import type { McpProject } from "@/lib/types";

export function CanvasPane({ project }: { project: McpProject | null }) {
  if (!project) {
    return (
      <main className="grid h-full place-items-center bg-[color:var(--color-ink-0)]">
        <div className="max-w-md px-10 text-center">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full border border-[color:var(--color-ink-border)] bg-[color:var(--color-ink-1)]">
            <Sparkles className="size-5 text-[color:var(--color-accent-1)]" />
          </div>
          <h2 className="text-base font-semibold tracking-tight text-[color:var(--color-ink-text-1)]">
            Live preview
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[color:var(--color-ink-text-2)]">
            The agent&apos;s project graph appears here as it&apos;s built —
            sources connect to the MCP Server output node and you can copy the
            live URL once it&apos;s ready.
          </p>
          <p className="mt-4 text-[11px] text-[color:var(--color-ink-text-3)]">
            Start by telling the agent what you need on the left.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="h-full overflow-hidden">
      <AgentCanvas project={project} />
    </main>
  );
}
