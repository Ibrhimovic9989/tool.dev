"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Plug, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useBuilder } from "@/lib/store";
import { useEffect, useState } from "react";

export default function ServersPage() {
  const router = useRouter();
  const projects = useBuilder((s) => s.projects);
  const newProject = useBuilder((s) => s.newProject);
  const deleteProject = useBuilder((s) => s.deleteProject);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => setHydrated(true), []);

  const items = Object.values(projects).sort((a, b) => b.updatedAt - a.updatedAt);

  const handleNew = () => {
    const id = newProject("Untitled MCP");
    router.push(`/builder?p=${id}`);
  };

  return (
    <div className="theme-noir min-h-screen bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Home
          </Link>
          <Button onClick={handleNew}>
            <Plus className="size-4" />
            New MCP
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-12">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">My MCPs</h1>
          <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            on this device
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Click any project to keep building.
        </p>

        {!hydrated ? (
          <p className="mt-8 text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <Card className="mt-8 border-[color:var(--color-ink-border)] bg-card">
            <CardContent className="p-10 text-center">
              <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full border border-[color:var(--color-ink-border)] bg-[color:var(--color-ink-2)] text-cyan-300">
                <Plug className="size-5" />
              </div>
              <h2 className="font-semibold">No MCPs yet</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Start one from scratch or use the landing page generator.
              </p>
              <Button onClick={handleNew} className="mt-4">
                <Plus className="size-4" />
                Create your first MCP
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((p) => {
              const sources = p.nodes.filter(
                (n) => n.data.kind !== "output.mcp",
              );
              const ready = sources.filter(
                (n) => n.data.status === "ready",
              ).length;
              return (
                <Card
                  key={p.id}
                  className="group bg-card hover:bg-[color:var(--color-ink-2)] transition"
                >
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        href={`/builder?p=${p.id}`}
                        className="font-semibold hover:underline truncate"
                      >
                        {p.name}
                      </Link>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 opacity-60 hover:opacity-100"
                        onClick={() => {
                          if (confirm(`Delete "${p.name}"?`)) deleteProject(p.id);
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                    {p.agency && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {p.agency}
                      </p>
                    )}
                    {p.description && (
                      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                        {p.description}
                      </p>
                    )}
                    <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <Badge variant="outline" className="font-mono">
                        {ready}/{sources.length} ready
                      </Badge>
                      <span className="ml-auto font-mono">
                        {new Date(p.updatedAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
