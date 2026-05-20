// Full Auth.js (v5) handler — Node runtime only.
// Middleware should NOT import this; it should import `auth.config.ts` so
// the Edge runtime can resolve providers without pulling in node-postgres.

import NextAuth from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { users, accounts, sessions, verificationTokens } from "@/db/schema";
import { authConfig } from "./auth.config";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
});
const db = drizzle(pool, {
  schema: { users, accounts, sessions, verificationTokens },
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
});
