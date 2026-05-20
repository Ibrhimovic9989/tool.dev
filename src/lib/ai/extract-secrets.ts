// Pulls secret values out of a free-form prompt entirely client-side,
// so the values never have to be returned by the AI provider in a separate
// step. Used after `describeToGraph` to populate `project.secrets`.
//
// Heuristics:
//   1. Any postgres:// or postgresql:// URL → extract password under
//      the env var name the AI assigned (or DB_PASSWORD).
//   2. Any line of the form `NAME=value` where NAME looks env-var-ish
//      (UPPER_SNAKE) → store under NAME, except for connection-string
//      assignments which we handle in (1).
//   3. Common Supabase / OpenAI-style key prefixes are kept verbatim
//      under their declared var name.
//
// The extractor is intentionally permissive — false positives are
// preferable to silently dropping secrets the user expected to be filled.

import { parsePostgresUrl } from "@/lib/db/connection-string";

export interface ExtractedSecrets {
  /** Map of env var name → value */
  secrets: Record<string, string>;
  /**
   * Per-source-kind hints. The hero uses these to pick which env var name
   * each source node's auth/password should reference.
   */
  hints: {
    /** First DB password env var name seen, if any */
    dbPasswordEnvVar?: string;
  };
}

export function extractSecretsFromPrompt(prompt: string): ExtractedSecrets {
  const secrets: Record<string, string> = {};
  const hints: ExtractedSecrets["hints"] = {};

  // (2) NAME=VALUE assignments, one per line (also handles inline)
  // Allow values with no spaces, OR quoted with " or '.
  const assignRe =
    /(?:^|\s)([A-Z][A-Z0-9_]{2,})\s*=\s*("([^"]+)"|'([^']+)'|(\S+))/g;
  for (const m of prompt.matchAll(assignRe)) {
    const name = m[1];
    const value = m[3] ?? m[4] ?? m[5] ?? "";
    if (!value) continue;
    // Skip connection-string-shaped values. They aren't injected at runtime
    // as opaque secrets — they're parsed (the password component lives in
    // its own env var, handled by step (1) below). Saving them here just
    // confuses the secrets manager and tempts callers to use the URL as
    // a password.
    if (looksLikeConnectionString(value)) continue;
    secrets[name] = value;
  }

  // (1) Connection strings — scan the whole prompt (we no longer kept any
  // assignment whose VALUE was a URL, so we have to look at the raw text).
  const candidates: string[] = [prompt];
  let dbPwd: string | null = null;
  let dbPwdName: string | undefined;
  for (const c of candidates) {
    const urlMatch = c.match(/\b(?:postgres(?:ql)?):\/\/\S+/);
    if (!urlMatch) continue;
    const parsed = parsePostgresUrl(urlMatch[0]);
    if (parsed?.password) {
      dbPwd = parsed.password;
      break;
    }
  }
  if (dbPwd) {
    // Decide which env var name to assign it to. Prefer existing
    // DATABASE_URL → store DB_PASSWORD; otherwise default DB_PASSWORD.
    dbPwdName = "DB_PASSWORD";
    secrets[dbPwdName] = dbPwd;
    hints.dbPasswordEnvVar = dbPwdName;
  }

  return { secrets, hints };
}

/**
 * Heuristic: a "connection string" is something whose value is a URL with a
 * recognised driver scheme — postgres://, postgresql://, mysql://, mongodb://,
 * redis://, sqlite://, etc. We deliberately keep this list short and only
 * cover schemes that show up in agency-data MCP work; anything else is treated
 * as a normal secret value.
 */
function looksLikeConnectionString(value: string): boolean {
  return /^(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|sqlite|jdbc|mssql):\/\//i.test(
    value.trim(),
  );
}

/** Names that almost never refer to *passwords* — they refer to URLs. */
const URL_ENV_VAR_HINT = /URL$|URI$|CONNSTRING$|CONN_STRING$|DSN$/;

/**
 * Sanity-check whether `envVar` is a sensible name for a password.
 * If it ends in `_URL` etc., it's the env var holding the *connection string*,
 * not the password, and using it as a password env var will silently break.
 */
export function isPlausiblePasswordEnvVar(envVar: string | undefined): boolean {
  if (!envVar) return false;
  return !URL_ENV_VAR_HINT.test(envVar);
}
