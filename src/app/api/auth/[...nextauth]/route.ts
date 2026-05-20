// NextAuth (Auth.js v5) catch-all handler.
import { handlers } from "@/auth";

export const runtime = "nodejs";
export const { GET, POST } = handlers;
