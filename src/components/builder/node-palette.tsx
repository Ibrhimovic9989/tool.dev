"use client";

import { Database, FileText, Globe, Plug, Server } from "lucide-react";
import type { NodeKind } from "@/lib/types";

const PALETTE: {
  kind: NodeKind;
  title: string;
  description: string;
  icon: React.ReactNode;
  color: string;
}[] = [
  {
    kind: "source.rest",
    title: "REST API",
    description: "Connect a REST API",
    icon: <Plug className="size-4" />,
    color: "bg-blue-100 text-blue-700",
  },
  {
    kind: "source.database",
    title: "Database",
    description: "Postgres / MySQL / SQL Server",
    icon: <Database className="size-4" />,
    color: "bg-emerald-100 text-emerald-700",
  },
  {
    kind: "source.documents",
    title: "Documents",
    description: "PDFs, Word, SharePoint",
    icon: <FileText className="size-4" />,
    color: "bg-amber-100 text-amber-700",
  },
  {
    kind: "source.webpage",
    title: "Website",
    description: "Crawl public pages",
    icon: <Globe className="size-4" />,
    color: "bg-purple-100 text-purple-700",
  },
  {
    kind: "output.mcp",
    title: "MCP Server",
    description: "What AI connects to",
    icon: <Server className="size-4" />,
    color: "bg-gov-100 text-gov-700",
  },
];

export function NodePalette() {
  return (
    <aside className="border-r bg-white flex flex-col overflow-y-auto">
      <div className="px-4 py-3 border-b">
        <h2 className="text-sm font-semibold">Building blocks</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Drag any block onto the canvas
        </p>
      </div>
      <div className="p-3 space-y-2">
        {PALETTE.map((p) => (
          <PaletteItem key={p.kind} {...p} />
        ))}
      </div>

      <div className="mt-auto border-t p-4 text-xs text-muted-foreground space-y-2">
        <p className="font-semibold text-foreground">Tip</p>
        <p>
          Drag <em>sources</em> onto the canvas, then drag a line from each
          source to your MCP Server. Click any block to configure it.
        </p>
      </div>
    </aside>
  );
}

function PaletteItem({
  kind,
  title,
  description,
  icon,
  color,
}: {
  kind: NodeKind;
  title: string;
  description: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/makemcp-node", kind);
        e.dataTransfer.effectAllowed = "move";
      }}
      className="group flex cursor-grab items-start gap-3 rounded-lg border bg-card p-3 transition hover:border-gov-500 hover:shadow-sm active:cursor-grabbing"
    >
      <div className={`grid size-8 place-items-center rounded-md ${color}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground line-clamp-2">
          {description}
        </div>
      </div>
    </div>
  );
}
