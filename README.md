# makemcp.dev

An agent that builds MCP (Model Context Protocol) servers for non-technical
government and SaaS teams. Paste a connection string, drop a folder of PDFs,
point at an API — the agent attaches it, discovers the schema, tests every
tool, and publishes a live MCP URL that Claude Desktop / ChatGPT can connect
to.

## Stack

- Next.js 15 (App Router) · TypeScript · Tailwind v4 · shadcn-style primitives
- Postgres on Supabase (`pgvector` for embeddings, `pg_graphql` enabled) via
  Drizzle ORM
- NextAuth (Auth.js v5) — Google OAuth, JWT sessions, DrizzleAdapter
- Azure OpenAI — `gpt-5.2-chat` for the agent, `text-embedding-3-small` for
  document search
- Azure Document Intelligence — OCR for scanned PDFs / images
- React Flow (`@xyflow/react`) for the visual canvas

## Run locally

```bash
cp .env.example .env
# fill in every value in .env (see § Environment variables)
npm install
node --env-file=.env scripts/bootstrap-db.mjs   # one-time: creates schema + extensions
npm run dev
```

Open <http://localhost:3000>. Sign in with Google to reach `/builder`.

## Environment variables

All of these must be set both locally (`.env`) and on Vercel
(Project Settings → Environment Variables). See [`.env.example`](.env.example)
for the full list with comments. The non-obvious ones:

| Var                                       | What it is                                           |
| ----------------------------------------- | ---------------------------------------------------- |
| `DATABASE_URL`                            | Supabase pooler URL (port 6543). Required.           |
| `AZURE_OPENAI_*`                          | Chat + embedding deployment.                         |
| `AZURE_DOCUMENT_INTELLIGENCE_*`           | OCR for scanned PDFs / images.                       |
| `AUTH_SECRET`                             | Random ≥32-char string. `openssl rand -base64 32`.   |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`    | Google OAuth client (web app type).                  |
| `AUTH_TRUST_HOST=true`                    | Required on Vercel previews so callbacks work.       |

## Deploying to Vercel

1. Import this repository in Vercel. Framework auto-detects as Next.js.
2. Add every variable from `.env.example` under Project Settings →
   Environment Variables, for the Production, Preview, and Development
   environments.
3. In Google Cloud Console → APIs & Services → Credentials → your OAuth
   client → **Authorized redirect URIs**, add:
   - `https://<your-vercel-domain>/api/auth/callback/google`
   - `https://*.vercel.app/api/auth/callback/google` (for previews — wildcard
     works if your client is configured for it)
4. Push to `main`. Vercel builds and deploys.
5. **One-time per database**: run `node --env-file=.env scripts/bootstrap-db.mjs`
   locally against the production `DATABASE_URL` to create extensions
   (`vector`, `pg_graphql`), the auth tables, projects, conversations,
   messages, and `vector_chunks`. Idempotent — safe to re-run.

The route-specific function timeouts (90s for the agent turn, 300s for
document indexing, etc.) live in [`vercel.json`](vercel.json). The
published MCP runtime at `/api/mcp/[slug]` is CORS-open so AI clients can
connect from any origin.

## Key paths

- `src/app/page.tsx` — landing
- `src/app/builder/*` — drag-and-drop canvas + chat panel
- `src/app/api/agent/turn/route.ts` — agent harness entry point
- `src/lib/agent/{tools,harness}.ts` — orchestrator + tool catalog
- `src/lib/server/mcp-runtime.ts` — what `/api/mcp/[slug]` dispatches to
- `src/lib/generators/server-generator.ts` — produces the downloadable Node
  MCP server zip
- `src/db/schema.ts` — Drizzle schema (projects, vector_chunks,
  conversations, messages, NextAuth tables)
- `scripts/bootstrap-db.mjs` — schema migration / one-time DB setup

## Tests

```bash
npm run typecheck
npm run build
```

The generator's smoke test is end-to-end: when you Download Code from the
builder and run `npm test` inside the zip, it spawns the built MCP server
and connects to it via the official SDK client to verify every announced
tool and resource.

## Caveats

- The Supabase Postgres tables have RLS off; the service-role-equivalent
  connection from Next.js writes everything. If you fork this for a public
  multi-tenant deployment, enable RLS and tie rows to `users.id` first.
- Tool calls go to Azure OpenAI; redact any sensitive data before letting
  end users send arbitrary text through the agent.
- Published MCP endpoints under `/api/mcp/[slug]` are world-accessible.
  Treat each published server as public; for private MCPs add a bearer
  token check in the route.
