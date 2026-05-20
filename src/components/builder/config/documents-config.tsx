"use client";

import { useState } from "react";
import {
  Plus,
  Trash2,
  Upload,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
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
import { useBuilder, useCurrentProject } from "@/lib/store";
import type { DocumentsSourceData, DocCollection } from "@/lib/types";
import { toast } from "sonner";

interface Props {
  nodeId: string;
  data: DocumentsSourceData & { kind: "source.documents" };
}

type UploadState =
  | { status: "uploading"; pct: number }
  | { status: "indexed"; chunks: number; strategy: string }
  | { status: "error"; message: string };

const ACCEPTED_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".doc",
  ".txt",
  ".md",
  ".csv",
  ".xlsx",
  ".xls",
  ".png",
  ".jpg",
  ".jpeg",
  ".tiff",
  ".tif",
  ".bmp",
];

function isAccepted(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export function DocumentsConfig({ nodeId, data }: Props) {
  const updateNodeData = useBuilder((s) => s.updateNodeData);
  const project = useCurrentProject();
  // fileName -> upload state, keyed by collectionId + name
  const [progress, setProgress] = useState<Record<string, UploadState>>({});
  // Which collection's dropzone is currently being hovered with a drag
  const [dragOver, setDragOver] = useState<string | null>(null);

  const setReady = (next: Partial<DocumentsSourceData>) => {
    const merged = { ...data, ...next };
    const ready = merged.collections.some(
      (c) => c.enabled && (c.files.length > 0 || c.sourceLocation),
    );
    updateNodeData(nodeId, { ...next, status: ready ? "ready" : "draft" });
  };

  const addCollection = () => {
    const c: DocCollection = {
      id: nanoid(8),
      resourceName: "",
      description: "",
      files: [],
      chunkSize: 1000,
      enabled: true,
    };
    setReady({ collections: [...data.collections, c] });
  };

  const updateCollection = (id: string, patch: Partial<DocCollection>) => {
    setReady({
      collections: data.collections.map((c) =>
        c.id === id ? { ...c, ...patch } : c,
      ),
    });
  };

  const removeCollection = (id: string) => {
    setReady({ collections: data.collections.filter((c) => c.id !== id) });
  };

  const handleFiles = async (collectionId: string, fileList: FileList | File[] | null) => {
    if (!fileList || !project) return;
    const target = data.collections.find((c) => c.id === collectionId);
    if (!target) return;

    const all = Array.from(fileList);
    const accepted = all.filter(isAccepted);
    const rejected = all.length - accepted.length;
    if (rejected > 0) {
      toast.error(
        `${rejected} file${rejected === 1 ? "" : "s"} skipped — unsupported format`,
      );
    }
    if (accepted.length === 0) return;

    // Optimistically add file rows so the user sees them while indexing runs.
    const newFiles = accepted.map((f) => ({
      name: f.name,
      size: f.size,
      mime: f.type,
    }));
    updateCollection(collectionId, { files: [...target.files, ...newFiles] });

    for (const file of accepted) {
      const key = `${collectionId}:${file.name}`;
      setProgress((p) => ({ ...p, [key]: { status: "uploading", pct: 0 } }));
      try {
        const form = new FormData();
        form.append("projectId", project.id);
        form.append("collectionId", collectionId);
        form.append("file", file);
        const res = await fetch("/api/docs/index", { method: "POST", body: form });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        setProgress((p) => ({
          ...p,
          [key]: {
            status: "indexed",
            chunks: json.chunks ?? 0,
            strategy: json.strategy ?? "",
          },
        }));
        // Patch the file row with the assigned blobKey (fileId) so the UI can
        // associate it with stored chunks later.
        const fresh = useBuilder.getState().projects[project.id]?.nodes.find(
          (n) => n.id === nodeId,
        );
        if (fresh && fresh.data.kind === "source.documents") {
          const col = fresh.data.collections.find((c) => c.id === collectionId);
          if (col) {
            updateCollection(collectionId, {
              files: col.files.map((f) =>
                f.name === file.name && !f.blobKey
                  ? { ...f, blobKey: json.fileId }
                  : f,
              ),
            });
          }
        }
        toast.success(`Indexed ${file.name} — ${json.chunks} chunks (${json.strategy})`);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Indexing failed";
        setProgress((p) => ({ ...p, [key]: { status: "error", message } }));
        toast.error(`${file.name}: ${message}`);
      }
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label>Where are your documents?</Label>
        <Select
          value={data.sourceKind}
          onValueChange={(v) =>
            setReady({ sourceKind: v as DocumentsSourceData["sourceKind"] })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="upload">Upload files from this computer</SelectItem>
            <SelectItem value="sharepoint">SharePoint folder</SelectItem>
            <SelectItem value="gdrive">Google Drive folder</SelectItem>
            <SelectItem value="url">Web URLs (PDF links)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <Label>Collections</Label>
          <Button variant="ghost" size="sm" onClick={addCollection}>
            <Plus className="size-3.5" />
            Add collection
          </Button>
        </div>
        {data.collections.length === 0 ? (
          <p className="text-xs text-muted-foreground rounded-md border border-dashed p-3">
            Group your documents into collections. For example: &quot;Patient
            guidelines&quot;, &quot;Policy circulars&quot;.
          </p>
        ) : (
          <div className="space-y-3">
            {data.collections.map((c) => (
              <div key={c.id} className="rounded-lg border p-3 space-y-2 bg-white">
                <div className="flex items-center gap-2">
                  <Input
                    className="h-8 text-xs"
                    placeholder="resource_name (e.g. health_policies)"
                    value={c.resourceName}
                    onChange={(e) =>
                      updateCollection(c.id, {
                        resourceName: e.target.value
                          .replace(/[^a-z0-9_]/gi, "_")
                          .toLowerCase(),
                      })
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => removeCollection(c.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <Textarea
                  rows={2}
                  className="text-xs"
                  placeholder="What's in this collection?"
                  value={c.description}
                  onChange={(e) =>
                    updateCollection(c.id, { description: e.target.value })
                  }
                />

                {data.sourceKind === "upload" ? (
                  <label
                    onDragEnter={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (e.dataTransfer.types.includes("Files")) {
                        setDragOver(c.id);
                      }
                    }}
                    onDragOver={(e) => {
                      // Required so the drop event actually fires.
                      e.preventDefault();
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = "copy";
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      // relatedTarget is the element being entered. If it's
                      // outside the label, the drag truly left.
                      const next = e.relatedTarget as Node | null;
                      if (!next || !e.currentTarget.contains(next)) {
                        setDragOver(null);
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDragOver(null);
                      handleFiles(c.id, e.dataTransfer.files);
                    }}
                    className={
                      "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed p-4 text-xs transition " +
                      (dragOver === c.id
                        ? "border-emerald-500/70 bg-emerald-500/10 text-foreground"
                        : "text-muted-foreground hover:bg-muted/40")
                    }
                  >
                    <span className="flex items-center gap-2">
                      <Upload className="size-4" />
                      {dragOver === c.id
                        ? "Drop to upload"
                        : "Drop files here or click to upload"}
                    </span>
                    <span className="text-[10.5px] text-muted-foreground/80">
                      PDF, DOCX, TXT, MD, CSV, XLSX/XLS, PNG, JPG, TIFF, BMP · up to 25 MB each
                    </span>
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      accept=".pdf,.docx,.doc,.txt,.md,.csv,.xlsx,.xls,.png,.jpg,.jpeg,.tiff,.tif,.bmp"
                      onChange={(e) => handleFiles(c.id, e.target.files)}
                    />
                  </label>
                ) : (
                  <Input
                    className="h-8 text-xs"
                    placeholder={
                      data.sourceKind === "url"
                        ? "PDF URL (or a JSON array of URLs)"
                        : "Folder URL or ID"
                    }
                    value={c.sourceLocation ?? ""}
                    onChange={(e) =>
                      updateCollection(c.id, { sourceLocation: e.target.value })
                    }
                  />
                )}

                {c.files.length > 0 && (
                  <div className="space-y-1">
                    {c.files.map((f, i) => {
                      const state = progress[`${c.id}:${f.name}`];
                      return (
                        <div
                          key={i}
                          className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1 text-xs"
                        >
                          <span className="truncate flex items-center gap-1.5">
                            {state?.status === "uploading" ? (
                              <Loader2 className="size-3 animate-spin shrink-0" />
                            ) : state?.status === "indexed" ? (
                              <CheckCircle2 className="size-3 text-emerald-600 shrink-0" />
                            ) : state?.status === "error" ? (
                              <AlertTriangle className="size-3 text-amber-600 shrink-0" />
                            ) : null}
                            <span className="truncate">{f.name}</span>
                          </span>
                          <span className="text-muted-foreground ml-2 shrink-0">
                            {state?.status === "indexed"
                              ? `${state.chunks} chunks · ${state.strategy}`
                              : state?.status === "error"
                                ? "failed"
                                : `${(f.size / 1024).toFixed(1)} KB`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-[10px]">
                    {c.files.length} file{c.files.length === 1 ? "" : "s"}
                  </Badge>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={c.enabled}
                      onChange={(e) =>
                        updateCollection(c.id, { enabled: e.target.checked })
                      }
                    />
                    Available to AI
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
