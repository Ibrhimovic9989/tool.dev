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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { McpProject } from "@/lib/types";

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

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setInput("");
    setEvents((cur) => [...cur, { kind: "user", text: trimmed }]);
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
        body: JSON.stringify({ conversationId: conv, message: trimmed }),
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
    <aside className="flex flex-col overflow-hidden border-r bg-white">
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
            placeholder="Tell the agent what to build…"
            rows={3}
            disabled={pending}
            className="resize-none border-0 shadow-none focus-visible:ring-0 px-3 pt-2.5 pb-1 text-sm"
          />
          <div className="flex items-center justify-between gap-2 px-3 pb-2.5">
            <p className="text-[11px] text-muted-foreground">
              <kbd className="rounded border px-1 text-[10px]">Enter</kbd> send ·{" "}
              <kbd className="rounded border px-1 text-[10px]">⇧Enter</kbd> newline
            </p>
            <Button
              type="submit"
              size="sm"
              disabled={pending || !input.trim()}
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
            "max-w-[90%] rounded-2xl rounded-tl-md px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap border",
            e.isError
              ? "bg-red-50 border-red-200 text-red-900"
              : "bg-muted/40",
          )}
        >
          {e.text}
        </div>
      </div>
    );
  }
  if (e.kind === "tool_call") {
    return (
      <div className="rounded-lg border bg-muted/30 px-3 py-2 text-[12px]">
        <div className="flex items-center gap-2 font-medium">
          <Wrench className="size-3 text-gov-600" />
          <span className="font-mono">{e.toolName}</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            running
          </span>
        </div>
        {e.toolArgs && Object.keys(e.toolArgs).length > 0 && (
          <pre className="mt-1.5 overflow-x-auto rounded bg-white p-2 font-mono text-[11px] text-muted-foreground border">
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
          "rounded-lg border px-3 py-2 text-[12px] flex items-start gap-2.5",
          e.isError ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50",
        )}
      >
        {e.isError ? (
          <XCircle className="size-3.5 mt-0.5 shrink-0 text-red-600" />
        ) : (
          <CheckCircle2 className="size-3.5 mt-0.5 shrink-0 text-emerald-600" />
        )}
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "font-medium",
              e.isError ? "text-red-900" : "text-emerald-900",
            )}
          >
            <span className="font-mono text-[11px]">{e.toolName}</span>{" "}
            <span className="opacity-70">{e.isError ? "failed" : "done"}</span>
          </div>
          <div className="opacity-80 mt-0.5">{e.toolResult?.message}</div>
        </div>
      </div>
    );
  }
  return null;
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
