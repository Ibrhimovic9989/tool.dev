// Drizzle schema for makemcp.dev's own backend (Supabase Postgres + pgvector).

import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  vector,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

// text-embedding-3-small returns 1536-dim vectors.
export const EMBEDDING_DIM = 1536;

// ─── NextAuth tables ────────────────────────────────────────────────────────
// Shape required by @auth/drizzle-adapter.

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull(),
  emailVerified: timestamp("email_verified", { mode: "date", withTimezone: true }),
  image: text("image"),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (a) => ({
    pk: primaryKey({ columns: [a.provider, a.providerAccountId] }),
  }),
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
  },
  (vt) => ({ pk: primaryKey({ columns: [vt.identifier, vt.token] }) }),
);

// ─── makemcp tables ─────────────────────────────────────────────────────────

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  // Owner — nullable for the brief grace period during migration. New rows
  // written by /api/deploy must always carry a non-null owner_id.
  ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  agency: text("agency").default("").notNull(),
  description: text("description").default("").notNull(),
  body: jsonb("body").notNull(),
  secrets: jsonb("secrets").default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

// ─── Agent conversations ────────────────────────────────────────────────────

export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Optional link to the project the agent is currently working on. NULL when
  // the user hasn't named a project yet.
  projectId: text("project_id"),
  title: text("title").default("").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    // Standard OpenAI roles + an extra "tool" for tool responses.
    role: text("role").notNull(),
    // Free-text content (user prompt or assistant final reply). NULL when the
    // turn was solely a tool call.
    content: text("content"),
    // For assistant turns: the tool calls the model emitted. Stored verbatim
    // so we can replay them on the wire when re-prompting the model.
    toolCalls: jsonb("tool_calls"),
    // For tool turns: which call this is responding to and the result.
    toolCallId: text("tool_call_id"),
    toolName: text("tool_name"),
    toolArgs: jsonb("tool_args"),
    toolResult: jsonb("tool_result"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    conversationIdx: index("messages_conversation_idx").on(t.conversationId),
  }),
);

export const vectorChunks = pgTable(
  "vector_chunks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    collectionId: text("collection_id").notNull(),
    fileId: text("file_id").notNull(),
    fileName: text("file_name").notNull(),
    text: text("text").notNull(),
    source: text("source"),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIM }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => ({
    projectIdx: index("vector_chunks_project_idx").on(table.projectId),
    collectionIdx: index("vector_chunks_collection_idx").on(table.collectionId),
  }),
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type VectorChunk = typeof vectorChunks.$inferSelect;
export type NewVectorChunk = typeof vectorChunks.$inferInsert;
