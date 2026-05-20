"use client";

import { useState } from "react";
import {
  Info,
  CircleDashed,
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Eye,
  EyeOff,
  Trash2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useBuilder, useCurrentProject } from "@/lib/store";

export function ProjectMeta() {
  const project = useCurrentProject();
  const updateProjectMeta = useBuilder((s) => s.updateProjectMeta);
  const selectNode = useBuilder((s) => s.selectNode);
  const removeSecret = useBuilder((s) => s.removeSecret);
  const setSecret = useBuilder((s) => s.setSecret);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  if (!project) return null;
  const secretEntries = Object.entries(project.secrets ?? {});

  const sourceNodes = project.nodes.filter((n) => n.data.kind !== "output.mcp");
  const drafts = sourceNodes.filter((n) => n.data.status !== "ready");
  const ready = sourceNodes.length > 0 && drafts.length === 0;

  return (
    <div className="p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Project details</h2>
        <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1.5">
          <Info className="size-3 mt-0.5 shrink-0" />
          Click any block on the canvas to configure it. The more context you give, the better AI assistants will use your MCP.
        </p>
      </div>

      {sourceNodes.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
          Drag a source block from the left to start connecting your data.
        </div>
      ) : drafts.length > 0 ? (
        <div className="rounded-lg border bg-amber-50 p-3 space-y-2">
          <div className="text-sm font-medium text-amber-900">
            {drafts.length} block{drafts.length === 1 ? "" : "s"} need
            configuration
          </div>
          <ul className="space-y-1.5">
            {drafts.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => selectNode(n.id)}
                  className="w-full flex items-center justify-between rounded-md bg-white px-2 py-1.5 text-xs hover:bg-amber-100 transition"
                >
                  <span className="flex items-center gap-2">
                    <CircleDashed className="size-3.5 text-amber-700" />
                    <span className="font-medium">{n.data.name || "Untitled"}</span>
                  </span>
                  <span className="flex items-center gap-1 text-amber-700">
                    Configure
                    <ArrowRight className="size-3" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="rounded-lg border bg-emerald-50 p-3 flex items-center gap-2 text-sm text-emerald-900">
          <CheckCircle2 className="size-4" />
          All blocks ready. Click <strong>Test</strong> to verify.
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="proj-name">Project name</Label>
        <Input
          id="proj-name"
          value={project.name}
          onChange={(e) =>
            updateProjectMeta(project.id, { name: e.target.value })
          }
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="proj-agency">Agency / department</Label>
        <Input
          id="proj-agency"
          value={project.agency}
          onChange={(e) =>
            updateProjectMeta(project.id, { agency: e.target.value })
          }
          placeholder="e.g. Ministry of Health"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="proj-desc">What this MCP is for</Label>
        <Textarea
          id="proj-desc"
          rows={4}
          value={project.description}
          onChange={(e) =>
            updateProjectMeta(project.id, { description: e.target.value })
          }
          placeholder="Briefly describe what your agency wants AI to do with this."
        />
      </div>

      <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold flex items-center gap-1.5">
            <KeyRound className="size-3.5" />
            Saved secrets
          </p>
          <span className="text-[11px] text-muted-foreground">on this device</span>
        </div>
        {secretEntries.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            None yet. Add a connection string or paste credentials and we&apos;ll
            remember them here for testing.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {secretEntries.map(([name, value]) => (
              <li
                key={name}
                className="rounded-md bg-white border p-2 space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <code className="text-xs font-mono">{name}</code>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      onClick={() =>
                        setRevealed((r) => ({ ...r, [name]: !r[name] }))
                      }
                      title={revealed[name] ? "Hide" : "Reveal"}
                    >
                      {revealed[name] ? (
                        <EyeOff className="size-3" />
                      ) : (
                        <Eye className="size-3" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      onClick={() => removeSecret(name)}
                      title="Remove"
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </div>
                <Input
                  type={revealed[name] ? "text" : "password"}
                  value={value}
                  onChange={(e) => setSecret(name, e.target.value)}
                  className="h-7 text-xs font-mono"
                />
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-muted-foreground pt-1">
          Secrets are stored unencrypted in your browser&apos;s localStorage.
          Use this for development and pilots; for production, fill them as env
          vars on your server.
        </p>
      </div>

      <div className="rounded-lg border bg-muted/40 p-3 text-xs space-y-1">
        <p className="font-semibold">Stats</p>
        <p>Blocks on canvas: {project.nodes.length}</p>
        <p>Connections: {project.edges.length}</p>
        <p>
          Last edited:{" "}
          {new Date(project.updatedAt).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </p>
      </div>
    </div>
  );
}
