"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, FileJson, Sparkles, Loader2 } from "lucide-react";
import { nanoid } from "nanoid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useBuilder } from "@/lib/store";
import type { RestSourceData, RestEndpoint } from "@/lib/types";
import { toast } from "sonner";

interface Props {
  nodeId: string;
  data: RestSourceData & { kind: "source.rest" };
}

export function RestConfig({ nodeId, data }: Props) {
  const updateNodeData = useBuilder((s) => s.updateNodeData);
  const [openApiUrl, setOpenApiUrl] = useState("");
  const [importing, startImport] = useTransition();

  const setReady = () => {
    const ready =
      !!data.baseUrl &&
      data.endpoints.some((e) => e.enabled && e.toolName);
    updateNodeData(nodeId, { status: ready ? "ready" : "draft" });
  };

  const addEmptyEndpoint = () => {
    const ep: RestEndpoint = {
      id: nanoid(8),
      toolName: "",
      description: "",
      method: "GET",
      path: "/",
      parameters: [],
      enabled: true,
    };
    updateNodeData(nodeId, { endpoints: [...data.endpoints, ep] });
  };

  const updateEndpoint = (id: string, patch: Partial<RestEndpoint>) => {
    updateNodeData(nodeId, {
      endpoints: data.endpoints.map((e) =>
        e.id === id ? { ...e, ...patch } : e,
      ),
    });
    setReady();
  };

  const removeEndpoint = (id: string) => {
    updateNodeData(nodeId, {
      endpoints: data.endpoints.filter((e) => e.id !== id),
    });
  };

  const handleImportOpenApi = () => {
    if (!openApiUrl.trim()) {
      toast.error("Paste an OpenAPI URL first.");
      return;
    }
    startImport(async () => {
      try {
        const res = await fetch("/api/import/openapi", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: openApiUrl.trim() }),
        });
        if (!res.ok) throw new Error(await res.text());
        const json = (await res.json()) as {
          baseUrl: string;
          endpoints: RestEndpoint[];
        };
        updateNodeData(nodeId, {
          baseUrl: data.baseUrl || json.baseUrl,
          endpoints: [...data.endpoints, ...json.endpoints],
        });
        toast.success(`Imported ${json.endpoints.length} endpoints`);
        setOpenApiUrl("");
        setReady();
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Couldn't import that spec",
        );
      }
    });
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="rest-base">API base URL</Label>
        <Input
          id="rest-base"
          placeholder="https://api.your-agency.gov"
          value={data.baseUrl}
          onChange={(e) => {
            updateNodeData(nodeId, { baseUrl: e.target.value });
            setReady();
          }}
        />
      </div>

      <div className="space-y-1.5">
        <Label>Authentication</Label>
        <Select
          value={data.auth.kind}
          onValueChange={(v) =>
            updateNodeData(nodeId, {
              auth: { ...data.auth, kind: v as RestSourceData["auth"]["kind"] },
            })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No authentication</SelectItem>
            <SelectItem value="apiKey">API key (header)</SelectItem>
            <SelectItem value="bearer">Bearer token</SelectItem>
            <SelectItem value="basic">HTTP basic</SelectItem>
          </SelectContent>
        </Select>
        {data.auth.kind === "apiKey" && (
          <div className="grid grid-cols-2 gap-2 pt-2">
            <Input
              placeholder="Header name (e.g. X-API-Key)"
              value={data.auth.keyName ?? ""}
              onChange={(e) =>
                updateNodeData(nodeId, {
                  auth: { ...data.auth, keyName: e.target.value },
                })
              }
            />
            <Input
              placeholder="Env var (e.g. API_KEY)"
              value={data.auth.secretEnvVar ?? ""}
              onChange={(e) =>
                updateNodeData(nodeId, {
                  auth: { ...data.auth, secretEnvVar: e.target.value },
                })
              }
            />
          </div>
        )}
        {data.auth.kind === "bearer" && (
          <Input
            className="mt-2"
            placeholder="Env var (e.g. API_TOKEN)"
            value={data.auth.secretEnvVar ?? ""}
            onChange={(e) =>
              updateNodeData(nodeId, {
                auth: { ...data.auth, secretEnvVar: e.target.value },
              })
            }
          />
        )}
        <p className="text-xs text-muted-foreground">
          Secrets are referenced by environment variable. Set them when you
          deploy — they&apos;re never stored in this tool.
        </p>
      </div>

      <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <FileJson className="size-4" />
          Import from OpenAPI / Swagger
        </div>
        <p className="text-xs text-muted-foreground">
          Paste a link to your spec — we&apos;ll create one tool per endpoint
          with AI-friendly descriptions.
        </p>
        <div className="flex gap-2">
          <Input
            placeholder="https://api.your-agency.gov/openapi.json"
            value={openApiUrl}
            onChange={(e) => setOpenApiUrl(e.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleImportOpenApi}
            disabled={importing}
          >
            {importing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            Import
          </Button>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <Label>Endpoints exposed to AI</Label>
          <Button variant="ghost" size="sm" onClick={addEmptyEndpoint}>
            <Plus className="size-3.5" />
            Add
          </Button>
        </div>
        {data.endpoints.length === 0 ? (
          <p className="text-xs text-muted-foreground rounded-md border border-dashed p-3">
            No endpoints yet. Import an OpenAPI spec above, or add one manually.
          </p>
        ) : (
          <div className="space-y-2">
            {data.endpoints.map((ep) => (
              <EndpointRow
                key={ep.id}
                ep={ep}
                onChange={(patch) => updateEndpoint(ep.id, patch)}
                onRemove={() => removeEndpoint(ep.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EndpointRow({
  ep,
  onChange,
  onRemove,
}: {
  ep: RestEndpoint;
  onChange: (patch: Partial<RestEndpoint>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border p-3 space-y-2 bg-white">
      <div className="flex items-center gap-2">
        <Select
          value={ep.method}
          onValueChange={(v) => onChange({ method: v as RestEndpoint["method"] })}
        >
          <SelectTrigger className="h-8 w-[88px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["GET", "POST", "PUT", "DELETE", "PATCH"] as const).map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="h-8 flex-1 text-xs font-mono"
          placeholder="/path"
          value={ep.path}
          onChange={(e) => onChange({ path: e.target.value })}
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onRemove}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      <Input
        className="h-8 text-xs"
        placeholder="tool_name (e.g. list_clinics)"
        value={ep.toolName}
        onChange={(e) =>
          onChange({ toolName: e.target.value.replace(/[^a-z0-9_]/gi, "_").toLowerCase() })
        }
      />
      <Textarea
        rows={2}
        className="text-xs"
        placeholder="What does this endpoint do?"
        value={ep.description}
        onChange={(e) => onChange({ description: e.target.value })}
      />
      <div className="flex items-center justify-between">
        <Badge variant="outline" className="text-[10px]">
          {ep.parameters.length} parameter{ep.parameters.length === 1 ? "" : "s"}
        </Badge>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={ep.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
          />
          Available to AI
        </label>
      </div>
    </div>
  );
}
