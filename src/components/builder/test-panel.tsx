"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  PlayCircle,
  Plug,
  Database,
  FileText,
  Globe,
  CheckCircle2,
  XCircle,
  Loader2,
  Activity,
  KeyRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useBuilder, useCurrentProject } from "@/lib/store";
import type {
  McpProject,
  RestEndpoint,
  RestSourceData,
  WebpageSourceData,
  DocumentsSourceData,
  DatabaseSourceData,
} from "@/lib/types";
import { cn } from "@/lib/utils";

interface TestTarget {
  /** Stable id for selecting in the UI */
  key: string;
  nodeId: string;
  nodeName: string;
  nodeKind: "source.rest" | "source.database" | "source.documents" | "source.webpage";
  /** "tool" or "resource" */
  kind: "tool" | "resource";
  /** The tool name or resource name */
  target: string;
  description: string;
  /** REST-specific extras */
  rest?: {
    method: string;
    path: string;
    params: { name: string; required: boolean; description: string }[];
    authEnvVar?: string;
  };
  /** DB-specific extras */
  db?: {
    schema: string;
    name: string;
    passwordEnvVar: string;
  };
  /** Documents-specific extras (search query vs similarity probe) */
  docs?: {
    kind: "search" | "similar";
    collectionName: string;
  };
}

type RunResult =
  | { ok: true; status?: number; durationMs: number; preview: string }
  | { ok: false; durationMs: number; error: string };

export function TestPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const project = useCurrentProject();
  const setProjectSecret = useBuilder((s) => s.setSecret);
  const targets = useMemo(() => (project ? buildTargets(project) : []), [project]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [args, setArgs] = useState<Record<string, string>>({});
  // The form's working copy of secrets — seeded from project.secrets so
  // values entered earlier (or extracted by the AI) are pre-filled.
  const [secrets, setSecrets] = useState<Record<string, string>>(
    () => ({ ...(project?.secrets ?? {}) }),
  );
  const [result, setResult] = useState<RunResult | null>(null);
  const [health, setHealth] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [pending, startTransition] = useTransition();
  const [healthPending, setHealthPending] = useState(false);

  // Reset selection when reopening
  useEffect(() => {
    if (open) {
      setResult(null);
      // Pull the latest stored secrets back into the form
      setSecrets({ ...(project?.secrets ?? {}) });
      if (!selectedKey && targets.length) setSelectedKey(targets[0].key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selected = targets.find((t) => t.key === selectedKey) ?? null;

  const runAll = () => {
    if (!project) return;
    setHealthPending(true);
    const ids = Array.from(new Set(targets.map((t) => t.nodeId)));
    Promise.all(
      ids.map(async (id) => {
        const res = await fetch("/api/test/health", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project, nodeId: id, secrets }),
        });
        const json = await res.json();
        return [id, { ok: !!json.ok, msg: json.message ?? "" }] as const;
      }),
    )
      .then((rows) => {
        const next: Record<string, { ok: boolean; msg: string }> = {};
        for (const [id, v] of rows) next[id] = v;
        setHealth(next);
      })
      .finally(() => setHealthPending(false));
  };

  useEffect(() => {
    if (open && project && targets.length) {
      runAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const runSelected = () => {
    if (!project || !selected) return;
    startTransition(async () => {
      const res = await fetch("/api/test/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project,
          nodeId: selected.nodeId,
          target: selected.target,
          args,
          secrets,
        }),
      });
      const json = (await res.json()) as RunResult & { error?: string };
      if (!res.ok && json && "error" in json) {
        setResult({
          ok: false,
          durationMs: 0,
          error: (json as { error?: string }).error ?? `HTTP ${res.status}`,
        });
        return;
      }
      setResult(json);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="flex items-center gap-2">
            <Activity className="size-4" />
            Test your MCP
          </DialogTitle>
          <DialogDescription>
            Run the same calls AI assistants would make. Connectivity is checked
            first; click any tool or resource to invoke it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[280px_1fr] h-[520px] border-t">
          <aside className="overflow-y-auto border-r">
            <div className="px-3 py-2 border-b flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Targets
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={runAll}
                disabled={healthPending}
                className="h-6 px-2 text-xs"
              >
                {healthPending ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  "Recheck"
                )}
              </Button>
            </div>
            {targets.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground">
                No tools or resources yet. Configure source blocks first.
              </p>
            ) : (
              <ul>
                {targets.map((t) => {
                  const h = health[t.nodeId];
                  return (
                    <li key={t.key}>
                      <button
                        onClick={() => {
                          setSelectedKey(t.key);
                          setResult(null);
                          setArgs({});
                        }}
                        className={cn(
                          "w-full text-left px-3 py-2 border-b flex items-start gap-2 hover:bg-muted/50",
                          selectedKey === t.key && "bg-muted",
                        )}
                      >
                        <TargetIcon kind={t.nodeKind} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs truncate">
                              {t.target}
                            </span>
                            {h ? (
                              h.ok ? (
                                <CheckCircle2 className="size-3 text-emerald-600 shrink-0" />
                              ) : (
                                <XCircle className="size-3 text-red-600 shrink-0" />
                              )
                            ) : null}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {t.nodeName} · {t.kind}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          <section className="flex flex-col overflow-hidden">
            {selected ? (
              <>
                <div className="p-6 overflow-y-auto flex-1 space-y-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <TargetIcon kind={selected.nodeKind} />
                      <span className="font-mono text-sm">{selected.target}</span>
                      <Badge variant="outline" className="ml-auto">
                        {selected.kind}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {selected.description || "No description."}
                    </p>
                    {selected.rest && (
                      <p className="mt-1 text-xs font-mono text-muted-foreground">
                        {selected.rest.method} {selected.rest.path}
                      </p>
                    )}
                  </div>

                  {(selected.rest?.authEnvVar || selected.db) && (() => {
                    const envVar = selected.db
                      ? selected.db.passwordEnvVar
                      : selected.rest!.authEnvVar!;
                    const value = secrets[envVar] ?? "";
                    const isSaved = !!(project?.secrets?.[envVar] && project.secrets[envVar] === value);
                    return (
                      <div className="rounded-md border bg-amber-50 p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2 text-xs font-medium text-amber-900">
                          <span className="flex items-center gap-2">
                            <KeyRound className="size-3.5" />
                            {selected.db ? "Database password" : "Auth secret"}
                          </span>
                          {isSaved && (
                            <span className="flex items-center gap-1 text-emerald-800">
                              <CheckCircle2 className="size-3" />
                              Saved on this device
                            </span>
                          )}
                        </div>
                        <Input
                          type="password"
                          placeholder={envVar}
                          value={value}
                          onChange={(e) => {
                            const v = e.target.value;
                            setSecrets((s) => ({ ...s, [envVar]: v }));
                            // Persist back to project — so future test
                            // sessions auto-fill without retyping.
                            setProjectSecret(envVar, v);
                          }}
                        />
                        <p className="text-[11px] text-amber-900">
                          Saved on this device only. On deployment, set this as
                          the env var <code>{envVar}</code>.
                        </p>
                      </div>
                    );
                  })()}

                  {selected.rest && selected.rest.params.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-xs">Arguments</Label>
                      {selected.rest.params.map((p) => (
                        <div key={p.name} className="space-y-1">
                          <div className="flex items-center gap-1.5 text-xs">
                            <span className="font-mono">{p.name}</span>
                            {p.required && (
                              <Badge variant="warning" className="text-[9px]">
                                required
                              </Badge>
                            )}
                          </div>
                          <Input
                            value={args[p.name] ?? ""}
                            onChange={(e) =>
                              setArgs((a) => ({ ...a, [p.name]: e.target.value }))
                            }
                            placeholder={p.description || p.name}
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {selected.docs?.kind === "search" && (
                    <div className="space-y-2">
                      <Label className="text-xs">Search query</Label>
                      <Input
                        value={args.query ?? ""}
                        onChange={(e) =>
                          setArgs((a) => ({ ...a, query: e.target.value }))
                        }
                        placeholder="e.g. annual leave policy"
                      />
                      <Label className="text-xs">Top K (optional)</Label>
                      <Input
                        type="number"
                        value={args.topK ?? ""}
                        onChange={(e) =>
                          setArgs((a) => ({ ...a, topK: e.target.value }))
                        }
                        placeholder="5"
                      />
                    </div>
                  )}

                  {selected.docs?.kind === "similar" && (
                    <div className="space-y-2">
                      <Label className="text-xs">Passage to compare</Label>
                      <Input
                        value={args.text ?? ""}
                        onChange={(e) =>
                          setArgs((a) => ({ ...a, text: e.target.value }))
                        }
                        placeholder="Paste 1-2 paragraphs you suspect are duplicated"
                      />
                      <Label className="text-xs">Min similarity (0-1, default 0.78)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={args.minScore ?? ""}
                        onChange={(e) =>
                          setArgs((a) => ({ ...a, minScore: e.target.value }))
                        }
                        placeholder="0.78"
                      />
                    </div>
                  )}

                  <Button onClick={runSelected} disabled={pending}>
                    {pending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <PlayCircle className="size-4" />
                    )}
                    Run test
                  </Button>

                  {result && <ResultBlock result={result} />}
                </div>
              </>
            ) : (
              <div className="grid place-items-center h-full text-sm text-muted-foreground">
                Select a tool or resource on the left to run it.
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ResultBlock({ result }: { result: RunResult }) {
  return (
    <div className="rounded-md border bg-white">
      <div
        className={cn(
          "flex items-center justify-between px-3 py-2 border-b text-xs",
          result.ok ? "bg-emerald-50" : "bg-red-50",
        )}
      >
        <div className="flex items-center gap-2">
          {result.ok ? (
            <CheckCircle2 className="size-4 text-emerald-700" />
          ) : (
            <XCircle className="size-4 text-red-700" />
          )}
          <span className="font-medium">
            {result.ok
              ? `Success${"status" in result && result.status ? ` · HTTP ${result.status}` : ""}`
              : "Failed"}
          </span>
        </div>
        <span className="text-muted-foreground">{result.durationMs} ms</span>
      </div>
      <pre className="text-xs p-3 max-h-72 overflow-auto font-mono whitespace-pre-wrap break-all">
        {result.ok ? result.preview : result.error}
      </pre>
    </div>
  );
}

function TargetIcon({
  kind,
}: {
  kind: TestTarget["nodeKind"];
}) {
  const cls = "size-4 text-muted-foreground shrink-0 mt-0.5";
  if (kind === "source.rest") return <Plug className={cls} />;
  if (kind === "source.database") return <Database className={cls} />;
  if (kind === "source.documents") return <FileText className={cls} />;
  return <Globe className={cls} />;
}

function buildTargets(project: McpProject): TestTarget[] {
  const output = project.nodes.find((n) => n.data.kind === "output.mcp");
  const connected = new Set(
    output
      ? project.edges.filter((e) => e.target === output.id).map((e) => e.source)
      : project.nodes.map((n) => n.id),
  );
  const targets: TestTarget[] = [];
  for (const node of project.nodes) {
    if (!connected.has(node.id)) continue;
    if (node.data.kind === "source.rest") {
      const d = node.data as RestSourceData & { kind: "source.rest" };
      for (const ep of d.endpoints.filter((e) => e.enabled && e.toolName)) {
        targets.push(restToTarget(node.id, d, ep));
      }
    } else if (node.data.kind === "source.webpage") {
      const d = node.data as WebpageSourceData & { kind: "source.webpage" };
      for (const t of d.targets.filter((x) => x.enabled && x.url)) {
        targets.push({
          key: `${node.id}:${t.id}`,
          nodeId: node.id,
          nodeName: node.data.name,
          nodeKind: "source.webpage",
          kind: "resource",
          target: t.resourceName || t.id,
          description: t.description,
        });
      }
    } else if (node.data.kind === "source.documents") {
      const d = node.data as DocumentsSourceData & { kind: "source.documents" };
      for (const c of d.collections.filter((x) => x.enabled && x.resourceName)) {
        const safe = c.resourceName.replace(/[^a-z0-9_]/gi, "_").toLowerCase().slice(0, 40);
        targets.push({
          key: `${node.id}:${c.id}:search`,
          nodeId: node.id,
          nodeName: node.data.name,
          nodeKind: "source.documents",
          kind: "tool",
          target: `search_${safe}`,
          description: `Semantic search over '${c.resourceName}'.`,
          docs: { kind: "search", collectionName: c.resourceName },
        });
        targets.push({
          key: `${node.id}:${c.id}:similar`,
          nodeId: node.id,
          nodeName: node.data.name,
          nodeKind: "source.documents",
          kind: "tool",
          target: `find_similar_${safe}`,
          description: `Find near-duplicate content in '${c.resourceName}'.`,
          docs: { kind: "similar", collectionName: c.resourceName },
        });
      }
    } else if (node.data.kind === "source.database") {
      const d = node.data as DatabaseSourceData & { kind: "source.database" };
      for (const t of d.tables.filter((x) => x.enabled && x.toolName)) {
        targets.push({
          key: `${node.id}:${t.id}`,
          nodeId: node.id,
          nodeName: node.data.name,
          nodeKind: "source.database",
          kind: "tool",
          target: t.toolName,
          description: t.description,
          db: {
            schema: t.schema,
            name: t.name,
            passwordEnvVar: d.passwordEnvVar,
          },
        });
      }
    }
  }
  return targets;
}

function restToTarget(
  nodeId: string,
  data: RestSourceData & { kind: "source.rest" },
  ep: RestEndpoint,
): TestTarget {
  return {
    key: `${nodeId}:${ep.id}`,
    nodeId,
    nodeName: data.name,
    nodeKind: "source.rest",
    kind: "tool",
    target: ep.toolName,
    description: ep.description,
    rest: {
      method: ep.method,
      path: ep.path,
      params: ep.parameters.map((p) => ({
        name: p.name,
        required: p.required,
        description: p.description,
      })),
      authEnvVar:
        data.auth.kind !== "none" ? data.auth.secretEnvVar : undefined,
    },
  };
}
