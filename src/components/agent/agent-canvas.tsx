"use client";

/* Hallmark · component-scope · noir-cyan
 * Read-only ReactFlow rendering of the agent's current project. No drag-to-add,
 * no node deletion — the agent owns the graph; the canvas is a live preview.
 */

import { useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  type Node as RFNode,
  type Edge as RFEdge,
} from "@xyflow/react";
import { Copy, Rocket, CheckCircle2, Loader2, Server } from "lucide-react";
import { toast } from "sonner";
import { AgentFlowNode } from "./agent-flow-node";
import type { McpProject } from "@/lib/types";

interface Props {
  project: McpProject;
}

const nodeTypes = {
  "source.rest": AgentFlowNode,
  "source.database": AgentFlowNode,
  "source.documents": AgentFlowNode,
  "source.webpage": AgentFlowNode,
  "output.mcp": AgentFlowNode,
};

export function AgentCanvas({ project }: Props) {
  return (
    <div className="flex h-full flex-col">
      <PublishBar project={project} />
      <div className="relative flex-1 bg-[color:var(--color-ink-0)]">
        <ReactFlowProvider>
          <InnerFlow project={project} />
        </ReactFlowProvider>
      </div>
    </div>
  );
}

function InnerFlow({ project }: Props) {
  const nodes: RFNode[] = useMemo(
    () =>
      project.nodes.map((n, i) => ({
        id: n.id,
        type: n.type,
        // If the agent placed nodes at (0,0) we'd see a pile, so apply a
        // gentle waterfall layout when positions look unset.
        position:
          n.position.x === 0 && n.position.y === 0
            ? { x: 60, y: 60 + i * 140 }
            : n.position,
        data: { node: n, selected: false },
        draggable: false,
        selectable: false,
      })),
    [project],
  );

  const edges: RFEdge[] = useMemo(
    () =>
      project.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        animated: true,
        style: {
          stroke: "oklch(0.72 0.14 245)",
          strokeWidth: 2,
        },
      })),
    [project],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.25 }}
      proOptions={{ hideAttribution: true }}
      minZoom={0.4}
      maxZoom={1.4}
      nodesDraggable={false}
      nodesConnectable={false}
      edgesFocusable={false}
      panOnDrag
      zoomOnScroll
      zoomOnPinch
      defaultEdgeOptions={{ animated: true }}
    >
      <Background gap={20} size={1.2} color="oklch(0.30 0.02 250 / 0.5)" />
      <Controls
        className="!bg-[color:var(--color-ink-1)] !border-[color:var(--color-ink-border)] !shadow-none"
        showInteractive={false}
      />
    </ReactFlow>
  );
}

function PublishBar({ project }: Props) {
  const [publishing, setPublishing] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const output = project.nodes.find((n) => n.data.kind === "output.mcp");
  const slug = output && output.data.kind === "output.mcp" ? output.data.slug : "";

  const url =
    publishedUrl ??
    (typeof window !== "undefined" && slug
      ? `${window.location.origin}/api/mcp/${slug}`
      : slug
        ? `/api/mcp/${slug}`
        : "");

  const ready = project.nodes
    .filter((n) => n.data.kind !== "output.mcp")
    .every((n) => n.data.status === "ready");

  const onPublish = async () => {
    if (!ready) {
      toast.error("One or more sources are still in draft.");
      return;
    }
    setPublishing(true);
    try {
      const res = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setPublishedUrl(json.url);
      toast.success("Published");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't publish");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="flex h-12 items-center gap-3 border-b border-[color:var(--color-ink-border)] bg-[color:var(--color-ink-0)] px-4 shrink-0">
      <Server className="size-3.5 text-[color:var(--color-ink-text-3)]" />
      {slug ? (
        <>
          <code className="flex-1 truncate font-mono text-[12px] text-[color:var(--color-ink-text-1)]">
            {url}
          </code>
          <button
            onClick={() => {
              navigator.clipboard.writeText(url);
              toast.success("Copied");
            }}
            className="noir-btn-ghost"
          >
            <Copy className="size-3" />
            Copy
          </button>
          <button
            onClick={onPublish}
            disabled={publishing}
            className="noir-btn"
          >
            {publishing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : publishedUrl ? (
              <CheckCircle2 className="size-3.5" />
            ) : (
              <Rocket className="size-3.5" />
            )}
            {publishedUrl ? "Published" : "Publish"}
          </button>
        </>
      ) : (
        <span className="text-[12px] text-[color:var(--color-ink-text-3)]">
          The agent will choose a slug when it creates your project.
        </span>
      )}
    </div>
  );
}
