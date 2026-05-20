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
import { Badge } from "@/components/ui/badge";
import type { McpNode } from "@/lib/types";

// Pill colors render on a dark card surface, so we use translucent tints +
// a desaturated foreground color that reads against oklch ~0.13 backgrounds.
const META = {
  "source.rest": {
    icon: <Plug className="size-4" />,
    pill: "API",
    color: "bg-sky-500/15 text-sky-300",
    border: "border-sky-500/30",
  },
  "source.database": {
    icon: <Database className="size-4" />,
    pill: "Database",
    color: "bg-emerald-500/15 text-emerald-300",
    border: "border-emerald-500/30",
  },
  "source.documents": {
    icon: <FileText className="size-4" />,
    pill: "Documents",
    color: "bg-amber-500/15 text-amber-300",
    border: "border-amber-500/30",
  },
  "source.webpage": {
    icon: <Globe className="size-4" />,
    pill: "Website",
    color: "bg-violet-500/15 text-violet-300",
    border: "border-violet-500/30",
  },
  "output.mcp": {
    icon: <Server className="size-4" />,
    pill: "MCP Server",
    color: "bg-cyan-500/15 text-cyan-300",
    border: "border-cyan-500/40",
  },
} as const;

interface Data {
  node: McpNode;
  selected: boolean;
}

export function McpFlowNode(props: NodeProps) {
  const { node, selected } = props.data as unknown as Data;
  const meta = META[node.type];
  const isOutput = node.type === "output.mcp";

  return (
    <div
      className={`w-[240px] rounded-xl border bg-card shadow-[0_10px_30px_-12px_oklch(0_0_0_/_0.5)] transition ${
        selected ? "ring-2 ring-cyan-400/60" : ""
      } ${meta.border}`}
    >
      {/* Source nodes have an output handle on the right */}
      {!isOutput && (
        <Handle
          type="source"
          position={Position.Right}
          className="!size-2.5 !border-2 !border-[color:var(--color-ink-0)] !bg-cyan-400"
        />
      )}
      {/* Output node has an input handle on the left */}
      {isOutput && (
        <Handle
          type="target"
          position={Position.Left}
          className="!size-2.5 !border-2 !border-[color:var(--color-ink-0)] !bg-cyan-400"
        />
      )}

      <div className="flex items-start gap-3 p-3">
        <div className={`grid size-9 place-items-center rounded-md ${meta.color}`}>
          {meta.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {meta.pill}
            </span>
            <StatusBadge status={node.data.status} />
          </div>
          <div className="mt-1 truncate text-sm font-semibold">
            {node.data.name || "Untitled"}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
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
      <Badge variant="success" className="gap-1">
        <CheckCircle2 className="size-3" />
        Ready
      </Badge>
    );
  }
  if (status === "error") {
    return (
      <Badge variant="warning" className="gap-1">
        <CircleAlert className="size-3" />
        Fix
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <CircleDashed className="size-3" />
      Draft
    </Badge>
  );
}

function summary(node: McpNode): string {
  switch (node.data.kind) {
    case "source.rest":
      return node.data.baseUrl
        ? `${node.data.endpoints.length} endpoint${node.data.endpoints.length === 1 ? "" : "s"} • ${node.data.baseUrl}`
        : "Add your API base URL";
    case "source.database":
      if (!node.data.host) return "Add database connection";
      if (node.data.tables.length === 0) {
        return `${node.data.engine} · ${node.data.host} — click Discover to add tables`;
      }
      return `${node.data.engine} · ${node.data.tables.length} table${node.data.tables.length === 1 ? "" : "s"}`;
    case "source.documents":
      return node.data.collections.length
        ? `${node.data.collections.length} collection${node.data.collections.length === 1 ? "" : "s"}`
        : "Upload or link documents";
    case "source.webpage":
      return node.data.targets.length
        ? `${node.data.targets.length} page${node.data.targets.length === 1 ? "" : "s"} • refresh every ${node.data.refreshHours}h`
        : "Add a page URL";
    case "output.mcp": {
      const origin =
        typeof window === "undefined" ? "" : window.location.origin;
      return `${origin || ""}/api/mcp/${node.data.slug}`;
    }
  }
}
