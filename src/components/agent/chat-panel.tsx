"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Loader2,
  Send,
  Sparkles,
  Wrench,
  CheckCircle2,
  XCircle,
  Paperclip,
  X,
  FileText,
  AlertTriangle,
  Upload,
} from "lucide-react";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useBuilder } from "@/lib/store";
import type { McpProject, DocCollection } from "@/lib/types";

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
const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.join(",");

function isAccepted(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

interface Attachment {
  id: string;
  name: string;
  size: number;
  mime: string;
  status: "uploading" | "indexed" | "error";
  chunks?: number;
  strategy?: string;
  fileId?: string;
  message?: string;
}

interface AgentEvent {
  kind: "user" | "assistant" | "tool_call" | "tool_result";
  text?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: { message: string; data?: unknown };
  isError?: boolean;
}

interface Props {
  onProjectChange?: (p: McpProject | null) => void;
  onConversationChange?: (id: string | null) => void;
  /**
   * When provided, the chat operates on this in-memory project. On send the
   * panel first syncs it to Postgres (via /api/projects/sync), runs an agent
   * turn against it, then hands the returned project back via
   * onProjectChange so the caller can update Zustand.
   */
  localProject?: McpProject | null;
}

const STARTERS = [
  "Connect my Supabase Postgres and expose every table as a tool.",
  "Build an MCP for finacra.com — REST + Documents.",
  "Index our policy PDFs and find duplicates.",
];

export function ChatPanel({
  onProjectChange,
  onConversationChange,
  localProject,
}: Props) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const searchParams = useSearchParams();
  const seedRef = useRef<string | null>(searchParams.get("seed"));

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [events]);

  useEffect(() => {
    if (seedRef.current) {
      setInput(seedRef.current);
      seedRef.current = null;
    }
  }, []);

  // Restore prior conversation when the chat panel mounts for an existing
  // project (e.g. after a page reload). The Zustand canvas survives the
  // reload because it's persisted to localStorage, but events live in
  // component state only — without this, the transcript appears empty
  // even though there's a real conversation backing the project.
  const loadedForProject = useRef<string | null>(null);
  useEffect(() => {
    const projectId = localProject?.id;
    if (!projectId) return;
    if (loadedForProject.current === projectId) return;
    loadedForProject.current = projectId;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/conversations/by-project?projectId=${encodeURIComponent(projectId)}`,
        );
        if (!res.ok) return;
        const json = (await res.json()) as {
          conversationId: string | null;
          events: AgentEvent[];
        };
        if (cancelled) return;
        if (json.conversationId) {
          setConversationId(json.conversationId);
          onConversationChange?.(json.conversationId);
        }
        if (json.events && json.events.length > 0) {
          // Only replace if the component hasn't already received events
          // (avoid trampling a mid-conversation state during HMR/dev).
          setEvents((cur) => (cur.length === 0 ? json.events : cur));
        }
      } catch {
        // Non-fatal — user can still chat, history just won't restore.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [localProject?.id, onConversationChange]);

  // Locate or create a "chat_uploads" collection on the project's Documents
  // node, minting the node itself if there isn't one yet. Returns the
  // collection id. Mutates the Zustand store directly because the chat panel
  // doesn't have a write callback for partial project edits.
  //
  // Also ensures there's an edge from the Documents node to the MCP output
  // node — without it, connectedSources() ignores the source at runtime and
  // listTools returns []. This caused several user-reported "no tools"
  // bugs on published MCPs that *did* have indexed files.
  const ensureChatCollection = (projectId: string): string => {
    const state = useBuilder.getState();
    const project = state.projects[projectId];
    if (!project) throw new Error("Project not found in store");

    let docNode = project.nodes.find((n) => n.data.kind === "source.documents");
    if (!docNode) {
      const newId = state.addNode("source.documents", { x: 240, y: 360 });
      const refreshed = useBuilder.getState().projects[projectId];
      docNode = refreshed?.nodes.find((n) => n.id === newId);
    }
    if (!docNode || docNode.data.kind !== "source.documents") {
      throw new Error("Couldn't ensure a Documents source");
    }

    // Wire the docs node into the MCP output if it isn't already.
    const outputNode = project.nodes.find((n) => n.data.kind === "output.mcp");
    if (outputNode) {
      const alreadyWired = project.edges.some(
        (e) => e.source === docNode!.id && e.target === outputNode.id,
      );
      if (!alreadyWired) state.connect(docNode.id, outputNode.id);
    }

    const existing = docNode.data.collections.find(
      (c) => c.resourceName === "chat_uploads",
    );
    if (existing) return existing.id;

    const newCollection: DocCollection = {
      id: nanoid(8),
      resourceName: "chat_uploads",
      description: "Documents you attached in chat",
      files: [],
      chunkSize: 1000,
      enabled: true,
    };
    state.updateNodeData(docNode.id, {
      collections: [...docNode.data.collections, newCollection],
    });
    return newCollection.id;
  };

  // After a file is indexed, register it on the Documents node's collection
  // so the canvas, /servers, and the next agent turn all see it.
  const recordIndexedFile = (
    projectId: string,
    collectionId: string,
    file: { name: string; size: number; mime: string },
    fileId: string,
  ) => {
    const state = useBuilder.getState();
    const project = state.projects[projectId];
    if (!project) return;
    const docNode = project.nodes.find((n) => n.data.kind === "source.documents");
    if (!docNode || docNode.data.kind !== "source.documents") return;
    const nextCollections = docNode.data.collections.map((c) =>
      c.id === collectionId
        ? {
            ...c,
            files: [
              ...c.files,
              { name: file.name, size: file.size, mime: file.mime, blobKey: fileId },
            ],
          }
        : c,
    );
    state.updateNodeData(docNode.id, {
      collections: nextCollections,
      status: "ready",
    });
  };

  const processFiles = async (raw: FileList | File[] | null) => {
    if (!raw) return;
    const project = localProject;
    if (!project) {
      toast.error("Open a project first.");
      return;
    }
    const all = Array.from(raw);
    const accepted = all.filter(isAccepted);
    const rejected = all.length - accepted.length;
    if (rejected > 0) {
      toast.error(
        `${rejected} file${rejected === 1 ? "" : "s"} skipped — unsupported format`,
      );
    }
    if (accepted.length === 0) return;

    let collectionId: string;
    try {
      collectionId = ensureChatCollection(project.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't prepare upload");
      return;
    }

    const chips: (Attachment & { _file: File })[] = accepted.map((file) => ({
      id: nanoid(8),
      name: file.name,
      size: file.size,
      mime: file.type,
      status: "uploading",
      _file: file,
    }));
    // Strip the private _file before pushing into state (it stays in this closure).
    setAttachments((prev) => [
      ...prev,
      ...chips.map(({ _file, ...rest }) => {
        void _file;
        return rest;
      }),
    ]);

    for (const chip of chips) {
      try {
        const form = new FormData();
        form.append("projectId", project.id);
        form.append("collectionId", collectionId);
        form.append("file", chip._file);
        const res = await fetch("/api/docs/index", { method: "POST", body: form });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === chip.id
              ? {
                  ...a,
                  status: "indexed",
                  chunks: json.chunks ?? 0,
                  strategy: json.strategy,
                  fileId: json.fileId,
                }
              : a,
          ),
        );
        recordIndexedFile(
          project.id,
          collectionId,
          { name: chip.name, size: chip.size, mime: chip.mime },
          json.fileId,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Indexing failed";
        setAttachments((prev) =>
          prev.map((a) => (a.id === chip.id ? { ...a, status: "error", message: msg } : a)),
        );
        toast.error(`${chip.name}: ${msg}`);
      }
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  // Drag-and-drop on the whole chat panel. dragDepth handles enter/leave on
  // nested children (without it, leaving a child fires dragleave even though
  // the cursor is still inside the panel).
  const onPanelDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragOver(true);
  };
  const onPanelDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onPanelDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  };
  const onPanelDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    processFiles(e.dataTransfer.files);
  };

  const send = async (text: string) => {
    const trimmed = text.trim();
    const stillUploading = attachments.some((a) => a.status === "uploading");
    if (stillUploading) {
      toast.error("Wait for uploads to finish.");
      return;
    }
    if (!trimmed && attachments.length === 0) return;
    if (pending) return;

    const indexed = attachments.filter((a) => a.status === "indexed");
    const attachmentPrefix =
      indexed.length > 0
        ? `[Attached ${indexed.length} file${indexed.length === 1 ? "" : "s"} into the "chat_uploads" Documents collection: ${indexed
            .map((a) => `${a.name} (${a.chunks ?? 0} chunks)`)
            .join(", ")}]\n`
        : "";
    const augmented = attachmentPrefix + trimmed;
    const displayText = trimmed || `📎 Attached ${indexed.length} file${indexed.length === 1 ? "" : "s"}`;

    setInput("");
    setAttachments([]);
    setEvents((cur) => [...cur, { kind: "user", text: displayText }]);
    setPending(true);
    try {
      let conv = conversationId;
      if (localProject) {
        const syncRes = await fetch("/api/projects/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project: localProject }),
        });
        const syncJson = await syncRes.json();
        if (!syncRes.ok) {
          throw new Error(
            syncJson.error ?? `Couldn't save your project (HTTP ${syncRes.status})`,
          );
        }
        conv = syncJson.conversationId;
      }

      const res = await fetch("/api/agent/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: conv, message: augmented }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setConversationId(json.conversationId);
      onConversationChange?.(json.conversationId);
      setEvents((cur) => [
        ...cur,
        ...(json.events as AgentEvent[]).map((e) => ({ ...e, kind: e.kind })),
      ]);
      if (json.project) onProjectChange?.(json.project as McpProject);
    } catch (e) {
      setEvents((cur) => [
        ...cur,
        {
          kind: "assistant",
          text: e instanceof Error ? e.message : "Something went wrong.",
          isError: true,
        },
      ]);
    } finally {
      setPending(false);
    }
  };

  return (
    <aside
      className="relative flex flex-col overflow-hidden border-r bg-white"
      onDragEnter={onPanelDragEnter}
      onDragOver={onPanelDragOver}
      onDragLeave={onPanelDragLeave}
      onDrop={onPanelDrop}
    >
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-gov-500/10 backdrop-blur-[1px]">
          <div className="rounded-2xl border-2 border-dashed border-gov-500 bg-white/95 px-6 py-5 text-center shadow-lg">
            <Upload className="mx-auto mb-2 size-6 text-gov-600" />
            <p className="text-sm font-medium">Drop files to attach</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              PDF, DOCX, TXT, MD, CSV, XLSX, images · multiple ok
            </p>
          </div>
        </div>
      )}

      <div className="border-b px-4 py-2.5">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
          <Sparkles className="size-3 text-gov-600" />
          Agent
        </div>
      </div>

      <div ref={scroller} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {events.length === 0 ? (
          <Welcome onPick={(t) => send(t)} starters={STARTERS} />
        ) : (
          events.map((e, i) => <EventRow key={i} e={e} />)
        )}
        {pending && (
          <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gov-500 opacity-60" />
              <span className="relative inline-flex size-1.5 rounded-full bg-gov-500" />
            </span>
            Thinking…
          </div>
        )}
      </div>

      <form
        className="border-t bg-white p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((a) => (
              <AttachmentChip key={a.id} a={a} onRemove={() => removeAttachment(a.id)} />
            ))}
          </div>
        )}

        <div className="rounded-xl border bg-white focus-within:border-gov-500 focus-within:ring-2 focus-within:ring-gov-500/15 transition">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={
              attachments.length > 0
                ? "Add a message, or send with just the files…"
                : "Tell the agent what to build… (drop files anywhere here)"
            }
            rows={3}
            disabled={pending}
            className="resize-none border-0 shadow-none focus-visible:ring-0 px-3 pt-2.5 pb-1 text-sm"
          />
          <div className="flex items-center justify-between gap-2 px-3 pb-2.5">
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                accept={ACCEPT_ATTR}
                onChange={(e) => {
                  processFiles(e.target.files);
                  // Reset so picking the same file twice still triggers onChange.
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={pending}
                className="h-7 gap-1 px-2 text-[11.5px] text-muted-foreground"
              >
                <Paperclip className="size-3.5" />
                Attach
              </Button>
              <p className="text-[11px] text-muted-foreground">
                <kbd className="rounded border px-1 text-[10px]">Enter</kbd> send
              </p>
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={
                pending ||
                attachments.some((a) => a.status === "uploading") ||
                (!input.trim() && attachments.filter((a) => a.status === "indexed").length === 0)
              }
              className="h-8"
            >
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
              Send
            </Button>
          </div>
        </div>
      </form>
    </aside>
  );
}

function AttachmentChip({
  a,
  onRemove,
}: {
  a: Attachment;
  onRemove: () => void;
}) {
  const icon =
    a.status === "uploading" ? (
      <Loader2 className="size-3 animate-spin text-muted-foreground shrink-0" />
    ) : a.status === "indexed" ? (
      <CheckCircle2 className="size-3 text-emerald-600 shrink-0" />
    ) : (
      <AlertTriangle className="size-3 text-amber-600 shrink-0" />
    );
  const detail =
    a.status === "uploading"
      ? "indexing…"
      : a.status === "indexed"
        ? `${a.chunks ?? 0} chunks`
        : "failed";
  const title =
    a.status === "error" ? a.message ?? "Indexing failed" : `${a.name} · ${detail}`;
  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-[220px] items-center gap-1.5 rounded-full border px-2 py-1 text-[11px]",
        a.status === "error"
          ? "border-amber-300 bg-amber-50"
          : a.status === "indexed"
            ? "border-emerald-200 bg-emerald-50"
            : "border-border bg-muted/40",
      )}
    >
      {icon}
      <FileText className="size-3 shrink-0 text-muted-foreground" />
      <span className="truncate font-medium">{a.name}</span>
      <span className="shrink-0 text-muted-foreground">{detail}</span>
      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Remove attachment"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

function EventRow({ e }: { e: AgentEvent }) {
  if (e.kind === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-gov-600 px-3 py-2 text-[13px] leading-relaxed text-white whitespace-pre-wrap">
          {e.text}
        </div>
      </div>
    );
  }
  if (e.kind === "assistant") {
    return (
      <div className="flex justify-start">
        <div
          className={cn(
            "max-w-[90%] rounded-2xl rounded-tl-md px-3 py-2 text-[13px] leading-relaxed border",
            e.isError
              ? "bg-red-50 border-red-200 text-red-900"
              : "bg-muted/40",
          )}
        >
          {e.isError ? (
            <span className="whitespace-pre-wrap">{e.text}</span>
          ) : (
            <RichText text={e.text ?? ""} />
          )}
        </div>
      </div>
    );
  }
  if (e.kind === "tool_call") {
    return (
      <div className="rounded-lg border bg-muted/30 px-3 py-2 text-[12px] overflow-hidden">
        <div className="flex items-center gap-2 font-medium">
          <Wrench className="size-3 text-gov-600" />
          <span className="font-mono truncate">{e.toolName}</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            running
          </span>
        </div>
        {e.toolArgs && Object.keys(e.toolArgs).length > 0 && (
          <pre className="mt-1.5 rounded bg-white p-2 font-mono text-[11px] text-muted-foreground border whitespace-pre-wrap break-words">
            {JSON.stringify(redact(e.toolArgs), null, 2)}
          </pre>
        )}
      </div>
    );
  }
  if (e.kind === "tool_result") {
    return (
      <div
        className={cn(
          "tool-result-card rounded-lg border px-3 py-2 text-[12px] flex items-start gap-2.5",
          e.isError ? "is-error" : "is-ok",
        )}
      >
        {e.isError ? (
          <XCircle className="size-3.5 mt-0.5 shrink-0 text-red-600" />
        ) : (
          <CheckCircle2 className="size-3.5 mt-0.5 shrink-0 text-emerald-600" />
        )}
        <div className="min-w-0 flex-1">
          <div className="tool-result-title font-medium">
            <span className="font-mono text-[11px]">{e.toolName}</span>{" "}
            <span className="opacity-70">{e.isError ? "failed" : "done"}</span>
          </div>
          <div className="tool-result-body mt-0.5 break-words">
            {e.toolResult?.message}
          </div>
        </div>
      </div>
    );
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline markdown renderer (purposefully tiny — the agent emits **bold**,
// *italic*, `code`, [text](url), and dash-bullets. Anything fancier renders
// as plain text rather than pulling in a 30KB dep.)
// ─────────────────────────────────────────────────────────────────────────────

function RichText({ text }: { text: string }) {
  const paras = text.split(/\n{2,}/);
  return (
    <div className="space-y-2">
      {paras.map((para, i) => {
        const lines = para.split("\n");
        const isList =
          lines.filter((l) => l.trim()).every((l) => /^\s*[-*]\s+/.test(l));
        if (isList) {
          return (
            <ul key={i} className="list-disc space-y-0.5 pl-5">
              {lines
                .filter((l) => l.trim())
                .map((l, j) => (
                  <li key={j}>{renderInline(l.replace(/^\s*[-*]\s+/, ""))}</li>
                ))}
            </ul>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap break-words">
            {lines.map((l, j) => (
              <span key={j}>
                {renderInline(l)}
                {j < lines.length - 1 && <br />}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function renderInline(s: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < s.length) {
    // `code`
    if (s[i] === "`") {
      const end = s.indexOf("`", i + 1);
      if (end > i) {
        out.push(
          <code
            key={key++}
            className="rounded bg-muted/60 px-1 py-[1px] font-mono text-[11.5px]"
          >
            {s.slice(i + 1, end)}
          </code>,
        );
        i = end + 1;
        continue;
      }
    }
    // **bold**
    if (s.startsWith("**", i)) {
      const end = s.indexOf("**", i + 2);
      if (end > i + 2) {
        out.push(<strong key={key++}>{s.slice(i + 2, end)}</strong>);
        i = end + 2;
        continue;
      }
    }
    // *italic* — only when preceded by start/space and followed by non-space
    if (
      s[i] === "*" &&
      s[i + 1] !== "*" &&
      s[i + 1] !== " " &&
      (i === 0 || /\s|\(/.test(s[i - 1]))
    ) {
      const end = s.indexOf("*", i + 1);
      if (end > i + 1) {
        out.push(<em key={key++}>{s.slice(i + 1, end)}</em>);
        i = end + 1;
        continue;
      }
    }
    // [text](url)
    if (s[i] === "[") {
      const match = s.slice(i).match(/^\[([^\]]+)\]\(([^)\s]+)\)/);
      if (match) {
        out.push(
          <a
            key={key++}
            href={match[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            {match[1]}
          </a>,
        );
        i += match[0].length;
        continue;
      }
    }
    // Plain run — accumulate until the next markup char
    let end = i + 1;
    while (
      end < s.length &&
      s[end] !== "`" &&
      !(s[end] === "*" && (s[end + 1] === "*" || /\s|^/.test(s[end - 1]))) &&
      s[end] !== "["
    ) {
      end++;
    }
    out.push(s.slice(i, end));
    i = end;
  }
  return out;
}

function Welcome({
  starters,
  onPick,
}: {
  starters: string[];
  onPick: (s: string) => void;
}) {
  return (
    <div className="max-w-sm mx-auto pt-2 text-center">
      <div className="mx-auto mb-3 grid size-9 place-items-center rounded-full border bg-muted/30">
        <Sparkles className="size-4 text-gov-600" />
      </div>
      <h2 className="text-sm font-semibold">Tell the agent what to build</h2>
      <p className="mt-1 text-[12.5px] text-muted-foreground leading-relaxed">
        I&apos;ll plan the MCP, attach your systems, and publish a live URL.
        Paste connection strings — I&apos;ll handle the rest.
      </p>
      <div className="mt-4 space-y-1.5 text-left">
        {starters.map((s, i) => (
          <button
            key={i}
            onClick={() => onPick(s)}
            className="w-full rounded-md border bg-muted/30 px-3 py-2 text-[12px] hover:bg-muted/60 hover:border-gov-500/30 transition text-left"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function redact(args: Record<string, unknown>): Record<string, unknown> {
  const SENSITIVE = /(password|token|key|secret|connectionString)/i;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string" && SENSITIVE.test(k)) {
      out[k] = v.length > 8 ? `${v.slice(0, 4)}…${v.slice(-2)}` : "•••";
    } else {
      out[k] = v;
    }
  }
  return out;
}
