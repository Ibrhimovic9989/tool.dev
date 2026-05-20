"use client";

/* Project grid in Lovable's house style: tab row + 3-up card grid.
 * Lovable's actual cards show a real deployed-site screenshot; we don't have
 * one yet, so each card's preview block uses a hue keyed to the project's
 * primary source type (db green, rest cyan-blue, docs amber, web violet) +
 * a soft glow + the project name rendered as a faint mono wordmark.
 *
 * Restrained on purpose — no centered icon, no caption inside the preview.
 * Status, source count and date live in the footer, exactly where Lovable
 * keeps them.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Trash2, MoreHorizontal } from "lucide-react";
import { useBuilder } from "@/lib/store";
import type { McpNode, McpProject } from "@/lib/types";

type Tab = "mine" | "recent" | "drafts";

export function YourProjects() {
  const [hydrated, setHydrated] = useState(false);
  const [tab, setTab] = useState<Tab>("mine");
  const projects = useBuilder((s) => s.projects);
  const deleteProject = useBuilder((s) => s.deleteProject);

  useEffect(() => setHydrated(true), []);
  if (!hydrated) return null;

  const all = Object.values(projects).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
  if (all.length === 0) return null;

  const isEmpty = (p: McpProject) =>
    p.nodes.filter((n) => n.data.kind !== "output.mcp").length === 0;
  const active = all.filter((p) => !isEmpty(p));
  const drafts = all.filter(isEmpty);

  const visible =
    tab === "mine" ? active : tab === "recent" ? all.slice(0, 9) : drafts;

  const onDelete = (e: React.MouseEvent, p: McpProject) => {
    e.preventDefault();
    e.stopPropagation();
    if (confirm(`Delete "${p.name}"?`)) deleteProject(p.id);
  };

  const clearAllEmpties = () => {
    if (drafts.length === 0) return;
    if (
      confirm(
        `Delete ${drafts.length} empty draft${drafts.length === 1 ? "" : "s"}?`,
      )
    ) {
      for (const p of drafts) deleteProject(p.id);
    }
  };

  return (
    <section>
      <div className="mx-auto max-w-6xl px-6 pb-20">
        <div className="mb-6 flex items-end justify-between gap-3">
          <h2 className="text-[15px] font-medium tracking-tight text-[color:var(--color-ink-text-1)]">
            Your projects
          </h2>

          <div className="flex items-center gap-1 rounded-full border border-[color:var(--color-ink-border)] bg-[color:var(--color-ink-1)] p-0.5 text-[12px]">
            <TabPill active={tab === "mine"} onClick={() => setTab("mine")}>
              Mine
              <Counter v={active.length} />
            </TabPill>
            <TabPill active={tab === "recent"} onClick={() => setTab("recent")}>
              Recent
            </TabPill>
            <TabPill active={tab === "drafts"} onClick={() => setTab("drafts")}>
              Drafts
              <Counter v={drafts.length} />
            </TabPill>
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[color:var(--color-ink-border)] bg-[color:var(--color-ink-1)]/30 p-10 text-center text-[13px] text-[color:var(--color-ink-text-3)]">
            {tab === "mine"
              ? "No active projects yet. Paste a connection string above to start one."
              : tab === "drafts"
                ? "No empty drafts."
                : "No recent projects."}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                onDelete={(e) => onDelete(e, p)}
              />
            ))}
          </div>
        )}

        {tab === "mine" && drafts.length > 0 && (
          <div className="mt-5 flex items-center justify-between gap-3 text-[12px] text-[color:var(--color-ink-text-3)]">
            <span>
              {drafts.length} empty draft{drafts.length === 1 ? "" : "s"} hidden
            </span>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setTab("drafts")}
                className="hover:text-[color:var(--color-ink-text-1)]"
              >
                View drafts
              </button>
              <button
                onClick={clearAllEmpties}
                className="hover:text-[oklch(0.78_0.14_25)]"
              >
                Clear all
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function TabPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        active
          ? "inline-flex items-center gap-1.5 rounded-full bg-[color:var(--color-ink-2)] px-3 py-1 text-[color:var(--color-ink-text-1)] shadow-sm"
          : "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[color:var(--color-ink-text-3)] hover:text-[color:var(--color-ink-text-1)]"
      }
    >
      {children}
    </button>
  );
}

function Counter({ v }: { v: number }) {
  if (v === 0) return null;
  return (
    <span className="font-mono text-[10.5px] text-[color:var(--color-ink-text-3)]">
      {v}
    </span>
  );
}

function ProjectCard({
  project,
  onDelete,
}: {
  project: McpProject;
  onDelete: (e: React.MouseEvent) => void;
}) {
  const sources = project.nodes.filter((n) => n.data.kind !== "output.mcp");
  const ready = sources.filter((n) => n.data.status === "ready").length;
  const isEmpty = sources.length === 0;
  const isPublished = project.nodes.some(
    (n) => n.data.kind === "output.mcp" && n.data.status === "ready",
  );
  const primaryKind = sources[0]?.data.kind ?? null;
  const hue = hueForKind(primaryKind, isEmpty);

  return (
    <Link
      href={`/builder?p=${project.id}`}
      className="group relative block overflow-hidden rounded-2xl border border-[color:var(--color-ink-border)] bg-[color:var(--color-ink-1)] transition hover:border-[color:var(--color-ink-border-strong)]"
    >
      <PreviewBlock
        project={project}
        hue={hue}
        isEmpty={isEmpty}
        isPublished={isPublished}
      />

      {/* Hover overlay actions — top-right of preview */}
      <div className="pointer-events-none absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition group-hover:opacity-100">
        <button
          type="button"
          onClick={onDelete}
          className="pointer-events-auto grid size-7 place-items-center rounded-full bg-[color:var(--color-ink-0)]/80 backdrop-blur-sm text-[color:var(--color-ink-text-2)] hover:text-[oklch(0.78_0.14_25)]"
          aria-label="Delete"
        >
          <Trash2 className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={(e) => e.preventDefault()}
          className="pointer-events-auto grid size-7 place-items-center rounded-full bg-[color:var(--color-ink-0)]/80 backdrop-blur-sm text-[color:var(--color-ink-text-2)] hover:text-[color:var(--color-ink-text-1)]"
          aria-label="More options"
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </div>

      {/* Footer: status dot + name + date right */}
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className={`size-1.5 shrink-0 rounded-full ${
                isPublished
                  ? "bg-[color:var(--color-accent-1)]"
                  : isEmpty
                    ? "border border-[color:var(--color-ink-border-strong)]"
                    : "bg-[color:var(--color-ink-text-3)]"
              }`}
            />
            <span className="truncate text-[13.5px] font-medium text-[color:var(--color-ink-text-1)]">
              {project.name}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[11.5px] text-[color:var(--color-ink-text-3)]">
            {isEmpty
              ? "empty draft"
              : `${ready}/${sources.length} ready${project.agency ? ` · ${project.agency}` : ""}`}
          </p>
        </div>
        <span className="shrink-0 font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--color-ink-text-3)]">
          {timeAgo(project.updatedAt)}
        </span>
      </div>
    </Link>
  );
}

function PreviewBlock({
  project,
  hue,
  isEmpty,
  isPublished,
}: {
  project: McpProject;
  hue: number;
  isEmpty: boolean;
  isPublished: boolean;
}) {
  return (
    <div
      className="relative aspect-[16/10] overflow-hidden"
      style={{
        background: isEmpty
          ? `linear-gradient(135deg, oklch(0.14 0.012 250) 0%, oklch(0.11 0.012 250) 100%)`
          : `linear-gradient(135deg, oklch(0.20 0.07 ${hue}) 0%, oklch(0.13 0.04 ${hue + 25}) 100%)`,
      }}
    >
      {/* Soft glow blob for non-empty projects */}
      {!isEmpty && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(55% 70% at 80% 25%, oklch(0.70 0.20 ${hue} / 0.50) 0%, transparent 70%)`,
            filter: "blur(28px)",
          }}
        />
      )}

      {/* Faint grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "linear-gradient(to right, oklch(1 0 0 / 0.04) 1px, transparent 1px), linear-gradient(to bottom, oklch(1 0 0 / 0.04) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      {/* Project name rendered as a faint wordmark in the upper-left */}
      <div className="absolute left-4 right-12 top-3.5 truncate font-serif italic text-[20px] leading-none text-[color:var(--color-ink-text-1)]/85"
        style={{ fontFamily: "var(--font-serif), serif" }}
      >
        {project.name}
      </div>
      <div className="absolute left-4 top-12 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-ink-text-3)]">
        {isEmpty ? "untitled" : "makemcp.dev"}
      </div>

      {/* Published pill bottom-left */}
      {isPublished && (
        <div className="absolute bottom-3 left-4 inline-flex items-center gap-1 rounded-full bg-[color:var(--color-ink-0)]/70 backdrop-blur-sm px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-accent-1)]">
          <span className="size-1 rounded-full bg-[color:var(--color-accent-1)]" />
          published
        </div>
      )}
    </div>
  );
}

/** Hue per primary source type so cards read differently at a glance. */
function hueForKind(
  kind: McpNode["data"]["kind"] | null,
  isEmpty: boolean,
): number {
  if (isEmpty) return 250;
  switch (kind) {
    case "source.database":
      return 155; // green
    case "source.rest":
      return 230; // cyan-blue
    case "source.documents":
      return 70; // amber
    case "source.webpage":
      return 290; // violet
    default:
      return 195; // default cyan
  }
}

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
