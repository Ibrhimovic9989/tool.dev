/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5
 * theme: noir-cyan · genre: modern-minimal
 * reference: published prototype at aurora-agent-maker.lovable.app
 * macrostructure: asymmetric hero · accepts row · anchor claim ·
 *   code band (file tree + Node) · your-projects · CTA · footer
 */

import Link from "next/link";
import { auth } from "@/auth";
import { DescribeHero } from "@/components/landing/describe-hero";
import { AgentTranscript } from "@/components/landing/agent-transcript";
import { YourProjects } from "@/components/landing/your-projects";
import { UserMenu } from "@/components/builder/user-menu";

export default async function Home() {
  const session = await auth();
  const user = session?.user
    ? {
        name: session.user.name ?? null,
        email: session.user.email ?? null,
        image: session.user.image ?? null,
      }
    : null;

  return (
    <main className="relative bg-[color:var(--color-ink-0)] text-[color:var(--color-ink-text-1)]">
      {/* ─── Top bar ──────────────────────────────────────────────────── */}
      <header className="relative z-20 border-b border-[color:var(--color-ink-border)]/50">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link
            href="/"
            className="flex items-center gap-2 text-[13px] font-semibold tracking-tight"
          >
            <span className="size-1.5 rounded-full bg-[color:var(--color-accent-1)]" />
            <span>
              makemcp
              <span className="text-[color:var(--color-ink-text-3)]">.dev</span>
            </span>
          </Link>
          <nav className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em]">
            <Link
              href="#how"
              className="px-3 py-1.5 text-[color:var(--color-ink-text-3)] hover:text-[color:var(--color-ink-text-1)]"
            >
              how it works
            </Link>
            <Link
              href="#own"
              className="px-3 py-1.5 text-[color:var(--color-ink-text-3)] hover:text-[color:var(--color-ink-text-1)]"
            >
              you own it
            </Link>
            {user ? (
              <>
                <Link href="/builder" className="noir-btn ml-2 normal-case tracking-normal">
                  start
                </Link>
                <UserMenu
                  name={user.name}
                  email={user.email}
                  image={user.image}
                />
              </>
            ) : (
              <>
                <Link
                  href="/signin"
                  className="px-3 py-1.5 text-[color:var(--color-ink-text-3)] hover:text-[color:var(--color-ink-text-1)]"
                >
                  sign in
                </Link>
                <Link href="/builder" className="noir-btn ml-2 normal-case tracking-normal">
                  start
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* ─── Asymmetric hero ──────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Faint grid behind the hero — adds tactile depth without being loud */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "linear-gradient(to right, oklch(1 0 0 / 0.025) 1px, transparent 1px), linear-gradient(to bottom, oklch(1 0 0 / 0.025) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            maskImage:
              "radial-gradient(60% 50% at 50% 30%, black 30%, transparent 80%)",
          }}
        />

        <div className="relative z-10 mx-auto grid max-w-6xl grid-cols-1 gap-12 px-6 pt-14 pb-20 md:grid-cols-12 md:gap-10 md:pt-20 md:pb-28">
          <div className="md:col-span-7 md:py-4">
            <Eyebrow>for government teams who don&apos;t ship code</Eyebrow>

            <h1 className="mt-6 text-[2.5rem] font-semibold leading-[1.03] tracking-[-0.025em] text-[color:var(--color-ink-text-1)] md:text-[3.75rem]">
              Build an MCP server
              <br />
              <span
                className="font-normal italic text-[color:var(--color-ink-text-3)]"
                style={{ fontFamily: "var(--font-serif), serif" }}
              >
                without writing one.
              </span>
            </h1>

            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-[color:var(--color-ink-text-2)]">
              Paste a connection string or drop a file and the agent ships a
              working MCP server your Claude Desktop can call.
            </p>

            <div className="mt-8 md:max-w-[520px]">
              <DescribeHero />
            </div>
          </div>

          <div className="md:col-span-5 md:py-4">
            <AgentTranscript />
          </div>
        </div>
      </section>

      {/* ─── Accepts row ──────────────────────────────────────────────── */}
      <section>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-6 pb-16">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-ink-text-3)]">
            accepts
          </span>
          {[
            "postgres://",
            "mysql://",
            "https://api/",
            "*.pdf",
            "*.csv",
            "s3://",
          ].map((t) => (
            <span
              key={t}
              className="rounded-full border border-[color:var(--color-ink-border)] bg-[color:var(--color-ink-1)] px-2.5 py-1 font-mono text-[11.5px] text-[color:var(--color-ink-text-2)]"
            >
              {t}
            </span>
          ))}
        </div>
      </section>

      {/* ─── Anchor claim ─────────────────────────────────────────────── */}
      <section id="how">
        <div className="mx-auto max-w-6xl px-6 pb-24">
          <h2 className="max-w-4xl text-3xl font-semibold leading-[1.15] tracking-tight md:text-[2.75rem]">
            One paste turns into a working MCP{" "}
            <span
              className="font-serif italic font-normal text-[color:var(--color-accent-1)]"
              style={{ fontFamily: "var(--font-serif), serif" }}
            >
              your AI clients
            </span>{" "}
            can call.
          </h2>
        </div>
      </section>

      {/* ─── Code band ────────────────────────────────────────────────── */}
      <section
        id="own"
        className="relative border-y border-[color:var(--color-ink-border)] bg-[oklch(0.08_0.018_250)]"
      >
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h3 className="text-2xl font-semibold tracking-tight md:text-[2rem]">
            You own the server.{" "}
            <span className="text-[color:var(--color-ink-text-3)]">
              It&apos;s a Node repo, not a wrapper.
            </span>
          </h3>
          <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-[color:var(--color-ink-text-2)]">
            We hand you a clean Node project under MIT. Read it, fork it,
            deploy it to your own infra. No hidden runtime, no per-call billing
            on the protocol.
          </p>

          <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-12">
            <aside className="md:col-span-3">
              <pre className="rounded-xl border border-[color:var(--color-ink-border)] bg-[color:var(--color-ink-1)] p-4 font-mono text-[12px] leading-[1.85] text-[color:var(--color-ink-text-2)]">
                <span className="text-[color:var(--color-ink-text-1)]">/ permits-mcp</span>
                {"\n"}package.json
                {"\n"}tsconfig.json
                {"\n"}
                <span className="text-[color:var(--color-accent-1)]">src/</span>
                {"\n  "}server.ts
                {"\n  "}db.ts
                {"\n  "}tools/
                {"\n"}README.md
                {"\n"}LICENSE (MIT)
              </pre>
              <p className="mt-3 px-1 text-[11px] text-[color:var(--color-ink-text-3)]">
                ~ 280 lines · 0 lockfile surprises
              </p>
            </aside>

            <pre className="md:col-span-9 overflow-x-auto rounded-xl border border-[color:var(--color-ink-border)] bg-[color:var(--color-ink-0)] p-5 font-mono text-[12.5px] leading-[1.7] text-[color:var(--color-ink-text-2)]">
              <code>{CODE_SAMPLE}</code>
            </pre>
          </div>
        </div>
      </section>

      {/* ─── Your projects (hidden if none) ───────────────────────────── */}
      <YourProjects />

      {/* ─── Final CTA ────────────────────────────────────────────────── */}
      <section id="start" className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(40% 60% at 30% 50%, oklch(0.65 0.18 230 / 0.30) 0%, transparent 70%), radial-gradient(35% 55% at 70% 60%, oklch(0.62 0.20 285 / 0.25) 0%, transparent 70%)",
            filter: "blur(60px)",
          }}
        />
        <div className="relative z-10 mx-auto max-w-6xl px-6 py-24 md:py-32">
          <h2 className="text-3xl font-semibold tracking-tight md:text-[3rem]">
            Start with one database.
          </h2>
          <p className="mt-3 max-w-lg text-[15px] text-[color:var(--color-ink-text-2)]">
            One connection string. Ten minutes. A server your team actually
            owns.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/builder"
              className="inline-flex items-center gap-2 rounded-xl bg-[oklch(0.85_0.14_195)] px-4 py-2.5 text-[14px] font-medium text-[oklch(0.18_0.05_220)] transition hover:bg-[oklch(0.80_0.14_195)] active:translate-y-px"
            >
              paste a connection string →
            </Link>
            <Link
              href="https://modelcontextprotocol.io"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-[color:var(--color-ink-border)] bg-[color:var(--color-ink-1)] px-4 py-2.5 text-[14px] text-[color:var(--color-ink-text-2)] hover:border-[color:var(--color-ink-border-strong)] hover:text-[color:var(--color-ink-text-1)]"
            >
              read the spec
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Footer ───────────────────────────────────────────────────── */}
      <footer className="border-t border-[color:var(--color-ink-border)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-6 py-7 text-[11px] text-[color:var(--color-ink-text-3)] sm:flex-row sm:items-center sm:justify-between">
          <span>
            makemcp.dev · for the people who file the permits
          </span>
          <span>
            v0.1 · built on the{" "}
            <Link
              href="https://modelcontextprotocol.io"
              className="underline-offset-2 hover:underline"
            >
              Model Context Protocol
            </Link>
          </span>
        </div>
      </footer>
    </main>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-ink-border)] bg-[color:var(--color-ink-1)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-ink-text-2)]">
      <span className="size-1.5 rounded-full bg-[color:var(--color-accent-1)]" />
      {children}
    </span>
  );
}

const CODE_SAMPLE = `// permits-mcp/src/server.ts
import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio";
import { db } from "./db";

const server = new Server(
  { name: "permits-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.tool("permits.count_by_range", {
  input: { from: "string", to: "string" },
  handler: async ({ from, to }) => {
    const rows = await db.query(
      "select count(*)::int as n from permits where filed_at between $1 and $2",
      [from, to],
    );
    return { count: rows[0].n };
  },
});

await server.connect(new StdioServerTransport());
`;
