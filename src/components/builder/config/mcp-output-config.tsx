"use client";

import { useEffect, useState } from "react";
import { Copy, Globe, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useBuilder } from "@/lib/store";
import type { McpOutputData } from "@/lib/types";
import { toast } from "sonner";

interface Props {
  nodeId: string;
  data: McpOutputData & { kind: "output.mcp" };
}

export function McpOutputConfig({ nodeId, data }: Props) {
  const updateNodeData = useBuilder((s) => s.updateNodeData);

  const set = (next: Partial<McpOutputData>) => {
    const merged = { ...data, ...next };
    const ready = !!merged.slug;
    updateNodeData(nodeId, { ...next, status: ready ? "ready" : "draft" });
  };

  // Use the origin the user is actually running on (localhost in dev, the
  // deployed origin in prod). Falls back to a placeholder during SSR.
  const [origin, setOrigin] = useState<string>("");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  const hostedUrl = `${origin || "https://makemcp.dev"}/api/mcp/${data.slug}`;

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label>URL slug</Label>
        <Input
          value={data.slug}
          onChange={(e) =>
            set({
              slug: e.target.value.replace(/[^a-z0-9-]/gi, "-").toLowerCase(),
            })
          }
          placeholder="ministry-of-health"
        />
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground truncate">{hostedUrl}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              navigator.clipboard.writeText(hostedUrl);
              toast.success("Copied");
            }}
          >
            <Copy className="size-3" />
            Copy
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>How will AI clients connect?</Label>
        <Select
          value={data.transport}
          onValueChange={(v) =>
            set({ transport: v as McpOutputData["transport"] })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="http">HTTP (web-based clients)</SelectItem>
            <SelectItem value="stdio">Stdio (desktop apps)</SelectItem>
            <SelectItem value="both">Both</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Visibility</Label>
        <Select
          value={data.visibility}
          onValueChange={(v) =>
            set({ visibility: v as McpOutputData["visibility"] })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="private">
              Private (requires auth token)
            </SelectItem>
            <SelectItem value="public">Public (anyone with the URL)</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground flex items-start gap-1.5">
          {data.visibility === "private" ? (
            <>
              <Lock className="size-3 mt-0.5 shrink-0" />
              Only callers with a valid token can use this MCP. Recommended for
              non-public data.
            </>
          ) : (
            <>
              <Globe className="size-3 mt-0.5 shrink-0" />
              Suitable for purely public data (e.g. open government datasets).
            </>
          )}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Rate limit (per minute, per client)</Label>
        <Input
          type="number"
          min={1}
          placeholder="60"
          value={data.rateLimitPerMin ?? ""}
          onChange={(e) =>
            set({
              rateLimitPerMin: e.target.value
                ? Number(e.target.value)
                : undefined,
            })
          }
        />
      </div>

      <div className="rounded-lg border bg-muted/40 p-3 text-xs space-y-1">
        <p className="font-semibold flex items-center gap-1">
          <Badge variant="outline">Tip</Badge>
          How to connect Claude Desktop
        </p>
        <p className="text-muted-foreground">
          After publishing, add this server in <em>Settings → Developer →
          Edit Config</em> on Claude Desktop, pointing at the URL above.
        </p>
      </div>
    </div>
  );
}
