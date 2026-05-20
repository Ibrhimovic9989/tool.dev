"use client";

import { Plus, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useBuilder } from "@/lib/store";
import type { WebpageSourceData, WebTarget } from "@/lib/types";

interface Props {
  nodeId: string;
  data: WebpageSourceData & { kind: "source.webpage" };
}

export function WebpageConfig({ nodeId, data }: Props) {
  const updateNodeData = useBuilder((s) => s.updateNodeData);

  const setReady = (next: Partial<WebpageSourceData>) => {
    const merged = { ...data, ...next };
    const ready = merged.targets.some((t) => t.enabled && t.url);
    updateNodeData(nodeId, { ...next, status: ready ? "ready" : "draft" });
  };

  const addTarget = () => {
    const t: WebTarget = {
      id: nanoid(8),
      url: "",
      resourceName: "",
      description: "",
      followLinks: false,
      maxDepth: 1,
      enabled: true,
    };
    setReady({ targets: [...data.targets, t] });
  };

  const updateTarget = (id: string, patch: Partial<WebTarget>) => {
    setReady({
      targets: data.targets.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    });
  };

  const removeTarget = (id: string) =>
    setReady({ targets: data.targets.filter((t) => t.id !== id) });

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label>How often should we refresh content?</Label>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            className="w-24"
            min={1}
            value={data.refreshHours}
            onChange={(e) =>
              setReady({ refreshHours: Number(e.target.value) || 24 })
            }
          />
          <span className="text-sm text-muted-foreground">hours</span>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <Label>Pages to crawl</Label>
          <Button variant="ghost" size="sm" onClick={addTarget}>
            <Plus className="size-3.5" />
            Add page
          </Button>
        </div>
        {data.targets.length === 0 ? (
          <p className="text-xs text-muted-foreground rounded-md border border-dashed p-3">
            Add a public page or a starting URL.
          </p>
        ) : (
          <div className="space-y-2">
            {data.targets.map((t) => (
              <div key={t.id} className="rounded-lg border p-3 space-y-2 bg-white">
                <div className="flex items-center gap-2">
                  <Input
                    className="h-8 text-xs"
                    placeholder="https://your-agency.gov/announcements"
                    value={t.url}
                    onChange={(e) =>
                      updateTarget(t.id, { url: e.target.value })
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => removeTarget(t.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <Input
                  className="h-8 text-xs"
                  placeholder="resource_name (e.g. announcements)"
                  value={t.resourceName}
                  onChange={(e) =>
                    updateTarget(t.id, {
                      resourceName: e.target.value
                        .replace(/[^a-z0-9_]/gi, "_")
                        .toLowerCase(),
                    })
                  }
                />
                <Textarea
                  rows={2}
                  className="text-xs"
                  placeholder="What's on these pages?"
                  value={t.description}
                  onChange={(e) =>
                    updateTarget(t.id, { description: e.target.value })
                  }
                />
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={t.followLinks}
                      onChange={(e) =>
                        updateTarget(t.id, { followLinks: e.target.checked })
                      }
                    />
                    Follow links
                  </label>
                  {t.followLinks && (
                    <label className="flex items-center gap-1">
                      depth:
                      <input
                        type="number"
                        min={1}
                        max={5}
                        value={t.maxDepth}
                        className="w-12 rounded border px-1 py-0.5"
                        onChange={(e) =>
                          updateTarget(t.id, {
                            maxDepth: Number(e.target.value) || 1,
                          })
                        }
                      />
                    </label>
                  )}
                  <Badge variant="outline" className="ml-auto text-[10px]">
                    {t.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
