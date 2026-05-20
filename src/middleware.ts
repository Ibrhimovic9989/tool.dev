// Auth middleware — everything is gated except the landing page, the auth
// endpoints, and the published MCP runtime (which is public by design).

import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);

const PUBLIC_PATHS = new Set<string>(["/", "/signin"]);

function isPublicApi(path: string): boolean {
  // The published MCP HTTP transport must stay open — AI clients call it.
  // The auth handlers obviously can't require auth.
  return path.startsWith("/api/auth") || path.startsWith("/api/mcp");
}

export default auth((req) => {
  const { nextUrl, auth: session } = req;
  const path = nextUrl.pathname;
  const isAuthed = !!session?.user;

  // Public allow-list.
  if (PUBLIC_PATHS.has(path) || isPublicApi(path)) {
    return NextResponse.next();
  }

  if (!isAuthed) {
    // API endpoints return a clean 401 instead of redirecting through HTML.
    if (path.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }
    const signIn = new URL("/signin", nextUrl);
    signIn.searchParams.set("callbackUrl", path + nextUrl.search);
    return NextResponse.redirect(signIn);
  }
  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\..*).*)",
  ],
};
