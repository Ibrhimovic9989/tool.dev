/* agent.log panel — hero right column.
 * Visual moves stolen from:
 *   - Lovable: format of `>` prompt / `✓` success / `→` tool lines
 *   - Replit: per-line timestamps (00:01 / 00:03 / 00:07) + macOS window dots
 *   - AI Studio: a "files being edited" sub-block with ✓ per file
 *   - Hallmark: kept to a single luminous element; soft glow only behind it
 */

export function AgentTranscript() {
  return (
    <div className="relative h-full">
      {/* Glow behind the panel only — not behind the whole hero. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-8 -inset-y-10 z-0 opacity-55"
        style={{
          background:
            "radial-gradient(55% 55% at 70% 30%, oklch(0.65 0.18 230 / 0.50) 0%, transparent 70%), radial-gradient(50% 50% at 30% 80%, oklch(0.70 0.16 195 / 0.40) 0%, transparent 65%)",
          filter: "blur(60px) saturate(140%)",
        }}
      />

      <figure className="relative z-10 overflow-hidden rounded-2xl bg-[color:var(--color-ink-1)]/85 backdrop-blur-sm shadow-[0_30px_60px_-30px_oklch(0.05_0.02_250/0.8),inset_0_1px_0_oklch(1_0_0/0.05)]">
        {/* macOS-style window chrome (Replit's move). Three dots + label. */}
        <figcaption className="flex items-center gap-3 border-b border-[color:var(--color-ink-border)] px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-[oklch(0.70_0.16_25)]" />
            <span className="size-2.5 rounded-full bg-[oklch(0.78_0.15_75)]" />
            <span className="size-2.5 rounded-full bg-[oklch(0.78_0.16_155)]" />
          </div>
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--color-ink-text-3)]">
            agent.log
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-accent-1)]">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--color-accent-1)] opacity-70" />
              <span className="relative inline-flex size-1.5 rounded-full bg-[color:var(--color-accent-1)]" />
            </span>
            live
          </span>
        </figcaption>

        <pre className="overflow-hidden whitespace-pre-wrap break-words px-4 py-4 font-mono text-[12.5px] leading-[1.75] text-[color:var(--color-ink-text-2)]">
          <LineWithTs ts="00:01">
            <Prompt>{">"}</Prompt>{" "}
            <Url>postgres://readonly@dept-records.gov:5432/permits</Url>
          </LineWithTs>
          <LineWithTs ts="00:02">
            <Check /> connected{" "}
            <Sep>·</Sep> 14 tables <Sep>·</Sep> 312 columns
          </LineWithTs>
          <LineWithTs ts="00:05">
            <Check /> inferred 9 safe read tools, 2 search tools
          </LineWithTs>
          {/* AI Studio's "editing files" sub-block, nested inside the agent log */}
          <div className="my-2 ml-[1.6rem] border-l border-[color:var(--color-ink-border)] pl-3 text-[11.5px]">
            <FileLine name="permits-mcp/package.json" />
            <FileLine name="permits-mcp/tsconfig.json" />
            <FileLine name="permits-mcp/src/server.ts" />
            <FileLine name="permits-mcp/src/db.ts" />
            <FileLine name="permits-mcp/src/tools/index.ts" />
          </div>
          <LineWithTs ts="00:09">
            <Check /> wired Claude Desktop config
          </LineWithTs>
          <LineWithTs ts="00:11">
            <Prompt>{">"}</Prompt>{" "}
            <span className="text-[color:var(--color-ink-text-1)]">
              claude: how many permits filed last week?
            </span>
          </LineWithTs>
          <LineWithTs ts="00:12">
            <Arrow /> tool call: permits.count_by_range
          </LineWithTs>
          <LineWithTs ts="00:12">
            <span className="text-[color:var(--color-ink-text-1)]">
              1,284 permits · 71% residential
            </span>
          </LineWithTs>
          <LineWithTs ts="">
            <Prompt>{">"}</Prompt> <Caret />
          </LineWithTs>
        </pre>
      </figure>
    </div>
  );
}

function LineWithTs({
  ts,
  children,
}: {
  ts: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-9 shrink-0 text-right text-[10.5px] text-[color:var(--color-ink-text-3)]/60">
        {ts}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

function FileLine({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2 text-[color:var(--color-ink-text-3)]">
      <span className="text-[oklch(0.78_0.14_155)] select-none">✓</span>
      <span>{name}</span>
    </div>
  );
}

function Prompt({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[color:var(--color-ink-text-3)] select-none">
      {children}
    </span>
  );
}
function Check() {
  return (
    <span className="text-[oklch(0.78_0.14_155)] select-none">✓</span>
  );
}
function Arrow() {
  return (
    <span className="text-[color:var(--color-accent-1)] select-none">→</span>
  );
}
function Sep({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[color:var(--color-ink-text-3)]">{children}</span>
  );
}
function Url({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[color:var(--color-accent-1)]">{children}</span>
  );
}
function Caret() {
  return (
    <span
      className="inline-block h-3 w-1.5 translate-y-0.5 bg-[color:var(--color-accent-1)]"
      style={{ animation: "noir-caret 1s steps(1) infinite" }}
    />
  );
}
