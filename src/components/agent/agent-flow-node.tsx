"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Database,
  FileText,
  Globe,
  Plug,
  Server,
  CheckCircle2,
  CircleDashed,
  CircleAlert,
} from "lucide-react";
import type { McpNode } from "@/lib/types";

const META = {
  "source.rest": { icon: Plug, label: "API" },
  "source.database": { icon: Database, label: "Database" },
  "source.documents": { icon: FileText, label: "Documents" },
  "source.webpage": { icon: Globe, label: "Website" },
  "output.mcp": { icon: Server, label: "MCP Server" },
} as const;

interface Data {
  node: McpNode;
  selected: boolean;
}

export function AgentFlowNode(props: NodeProps) {
  const { node } = props.data as unknown as Data;
  const meta = META[node.type];
  const Icon = meta.icon;
  const isOutput = node.type === "output.mcp";

  return (
    <div className="w-[240px] rounded-xl border border-[color:var(--color-ink-border)] bg-[color:var(--color-ink-1)] shadow-[0_10px_30px_-12px_oklch(0_0_0_/_0.6)]">
      {!isOutput && (
        <Handle
          type="source"
          position={Position.Right}
          className="!size-2 !border-2 !border-[color:var(--color-ink-0)] !bg-[color:var(--color-accent-1)]"
        />
      )}
      {isOutput && (
        <Handle
          type="target"
          position={Position.Left}
          className="!size-2 !border-2 !border-[color:var(--color-ink-0)] !bg-[color:var(--color-accent-1)]"
        />
      )}

      <div className="flex items-start gap-3 p-3">
        <div className="grid size-8 place-items-center rounded-md bg-[color:var(--color-ink-2)] text-[color:var(--color-accent-1)]">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--color-ink-text-3)]">
              {meta.label}
            </span>
            <StatusBadge status={node.data.status} />
          </div>
          <div className="mt-1 truncate text-sm font-medium text-[color:var(--color-ink-text-1)]">
            {node.data.name || "Untitled"}
          </div>
          <div className="mt-0.5 line-clamp-2 text-[11px] text-[color:var(--color-ink-text-3)]">
            {summary(node)}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: "draft" | "ready" | "error" }) {
  if (status === "ready") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[oklch(0.25_0.08_155)] px-1.5 py-0.5 text-[9px] font-medium text-[oklch(0.85_0.12_155)]">
        <CheckCircle2 className="size-2.5" />
        Ready
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[oklch(0.28_0.10_25)] px-1.5 py-0.5 text-[9px] font-medium text-[oklch(0.85_0.12_25)]">
        <CircleAlert className="size-2.5" />
        Fix
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--color-ink-border)] bg-[color:var(--color-ink-2)] px-1.5 py-0.5 text-[9px] text-[color:var(--color-ink-text-3)]">
      <CircleDashed className="size-2.5" />
      Draft
    </span>
  );
}

function summary(node: McpNode): string {
  switch (node.data.kind) {
    case "source.rest":
      return node.data.baseUrl
        ? `${node.data.endpoints.length} endpoint${node.data.endpoints.length === 1 ? "" : "s"} · ${node.data.baseUrl}`
        : "Awaiting base URL";
    case "source.database":
      if (!node.data.host) return "Awaiting connection";
      return `${node.data.engine} · ${node.data.host} · ${node.data.tables.length} table${node.data.tables.length === 1 ? "" : "s"}`;
    case "source.documents":
      return node.data.collections.length
        ? `${node.data.collections.length} collection${node.data.collections.length === 1 ? "" : "s"}`
        : "No documents yet";
    case "source.webpage":
      return node.data.targets.length
        ? `${node.data.targets.length} page${node.data.targets.length === 1 ? "" : "s"}`
        : "Awaiting URL";
    case "output.mcp":
      return `mcp/${node.data.slug}`;
  }
}
