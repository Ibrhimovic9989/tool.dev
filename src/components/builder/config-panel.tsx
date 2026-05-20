"use client";

import { Info, Settings2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useBuilder, useSelectedNode, useCurrentProject } from "@/lib/store";
import { RestConfig } from "./config/rest-config";
import { DatabaseConfig } from "./config/database-config";
import { DocumentsConfig } from "./config/documents-config";
import { WebpageConfig } from "./config/webpage-config";
import { McpOutputConfig } from "./config/mcp-output-config";
import { ProjectMeta } from "./config/project-meta";

export function ConfigPanel() {
  const node = useSelectedNode();
  const project = useCurrentProject();
  const updateNodeData = useBuilder((s) => s.updateNodeData);
  const removeNode = useBuilder((s) => s.removeNode);

  if (!project) return null;

  if (!node) {
    return (
      <aside className="border-l bg-white overflow-y-auto">
        <ProjectMeta />
      </aside>
    );
  }

  return (
    <aside className="border-l bg-white flex flex-col overflow-hidden">
      <div className="border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <Settings2 className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold truncate">{node.data.name || "Untitled"}</h2>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => removeNode(node.id)}
          title="Delete this block"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-4 p-4">
          {/* Common fields */}
          <div className="space-y-1.5">
            <Label htmlFor="node-name">Name</Label>
            <Input
              id="node-name"
              value={node.data.name}
              onChange={(e) =>
                updateNodeData(node.id, { name: e.target.value })
              }
              placeholder="Give this block a friendly name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="node-desc">Description</Label>
            <Textarea
              id="node-desc"
              value={node.data.description}
              onChange={(e) =>
                updateNodeData(node.id, { description: e.target.value })
              }
              placeholder="Briefly describe what this is for"
              rows={2}
            />
            <p className="text-xs text-muted-foreground flex items-start gap-1.5">
              <Info className="size-3 mt-0.5 shrink-0" />
              This description helps AI assistants understand when to use this block.
            </p>
          </div>

          <div className="h-px bg-border my-2" />

          {/* Type-specific config */}
          {node.data.kind === "source.rest" && (
            <RestConfig nodeId={node.id} data={node.data} />
          )}
          {node.data.kind === "source.database" && (
            <DatabaseConfig nodeId={node.id} data={node.data} />
          )}
          {node.data.kind === "source.documents" && (
            <DocumentsConfig nodeId={node.id} data={node.data} />
          )}
          {node.data.kind === "source.webpage" && (
            <WebpageConfig nodeId={node.id} data={node.data} />
          )}
          {node.data.kind === "output.mcp" && (
            <McpOutputConfig nodeId={node.id} data={node.data} />
          )}
        </div>
      </div>
    </aside>
  );
}
