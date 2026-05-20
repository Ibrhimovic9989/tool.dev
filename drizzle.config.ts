import "dotenv/config";
import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // Supabase Auth schema and pgvector internals shouldn't be touched.
  schemaFilter: ["public"],
  verbose: true,
  strict: true,
} satisfies Config;
