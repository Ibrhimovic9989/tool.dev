/* Hallmark · pre-emit critique: P5 H5 E5 S4 R5 V4
 * theme: noir-cyan · genre: modern-minimal · component: app-shell
 * states: covered in children
 */

"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { ChatPanel } from "./chat-panel";
import { CanvasPane } from "./canvas-pane";
import { UserMenu } from "@/components/builder/user-menu";
import type { McpProject } from "@/lib/types";

interface Props {
  user: { name: string | null; email: string | null; image: string | null };
}

export function AppShell({ user }: Props) {
  const [project, setProject] = useState<McpProject | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);

  return (
    <div className="flex h-screen flex-col bg-[color:var(--color-ink-0)] text-[color:var(--color-ink-text-1)]">
      <header className="flex h-14 items-center justify-between border-b border-[color:var(--color-ink-border)] bg-[color:var(--color-ink-0)] px-5 shrink-0">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-semibold tracking-tight text-[color:var(--color-ink-text-1)]"
          >
            <span className="grid size-6 place-items-center rounded bg-[color:var(--color-ink-text-1)] text-[10px] font-bold text-[color:var(--color-ink-0)]">
              m
            </span>
            makemcp
          </Link>
          {project ? (
            <>
              <span className="text-[color:var(--color-ink-text-3)]">/</span>
              <span className="text-sm font-medium text-[color:var(--color-ink-text-1)] truncate max-w-[280px]">
                {project.name}
              </span>
              <span className="rounded-full border border-[color:var(--color-ink-border)] bg-[color:var(--color-ink-1)] px-2 py-0.5 text-[10px] font-mono text-[color:var(--color-ink-text-3)]">
                {project.id.slice(0, 12)}
              </span>
            </>
          ) : (
            <span className="text-[11px] uppercase tracking-wider text-[color:var(--color-ink-text-3)]">
              Untitled session
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs">
          {conversationId && (
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-ink-border)] bg-[color:var(--color-ink-1)] px-2.5 py-1 text-[11px] font-mono text-[color:var(--color-ink-text-3)]">
              conv · {conversationId.slice(0, 10)}
            </span>
          )}
          <Link
            href="/"
            className="hidden sm:inline-flex items-center gap-1 text-[color:var(--color-ink-text-2)] hover:text-[color:var(--color-ink-text-1)]"
          >
            Home
            <ArrowUpRight className="size-3" />
          </Link>
          <UserMenu name={user.name} email={user.email} image={user.image} />
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 md:grid-cols-[440px_1fr] overflow-hidden">
        <ChatPanel
          onProjectChange={setProject}
          onConversationChange={setConversationId}
        />
        <CanvasPane project={project} />
      </div>
    </div>
  );
}
