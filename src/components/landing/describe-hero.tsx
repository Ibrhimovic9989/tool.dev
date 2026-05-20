"use client";

/* Single-line terminal-style hero input.
 * Loose visual reference: Lovable's published prototype at
 * aurora-agent-maker.lovable.app — `$` prefix, cyan accent action button,
 * three-pill meta row underneath.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";

const EXAMPLE_PLACEHOLDER =
  "postgres://readonly@dept-records.gov:5432/permits";

export function DescribeHero() {
  const router = useRouter();
  const [text, setText] = useState("");

  const submit = () => {
    const seed = text.trim();
    const qs = seed ? `?seed=${encodeURIComponent(seed)}` : "";
    router.push(`/builder${qs}`);
  };

  return (
    <div className="w-full">
      <div className="flex items-center gap-2 rounded-2xl border border-[color:var(--color-ink-border)] bg-[color:var(--color-ink-1)] p-1.5 shadow-[0_20px_60px_-30px_oklch(0.30_0.20_195_/_0.45)]">
        <span className="pl-3 pr-1 font-mono text-[color:var(--color-ink-text-3)] select-none">
          $
        </span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={EXAMPLE_PLACEHOLDER}
          className="flex-1 bg-transparent py-2.5 font-mono text-[13.5px] text-[color:var(--color-ink-text-1)] placeholder:text-[color:var(--color-ink-text-3)] focus:outline-none"
          spellCheck={false}
          autoComplete="off"
        />
        <button
          onClick={submit}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[oklch(0.85_0.14_195)] px-3.5 py-2 text-[13px] font-medium text-[oklch(0.18_0.05_220)] transition hover:bg-[oklch(0.80_0.14_195)] active:translate-y-px"
        >
          build it
          <ArrowRight className="size-3.5" />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[11px] text-[color:var(--color-ink-text-3)]">
        <span className="inline-flex items-center gap-1">
          <kbd className="rounded border border-[color:var(--color-ink-border)] px-1 font-mono text-[10px]">
            ↵
          </kbd>
          to ship
        </span>
        <span aria-hidden>·</span>
        <span>no signup to preview</span>
        <span aria-hidden>·</span>
        <span>read-only by default</span>
      </div>
    </div>
  );
}
