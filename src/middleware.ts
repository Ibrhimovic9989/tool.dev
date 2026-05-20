// Auth middleware — Edge-runtime safe.
//
// We don't instantiate NextAuth here on purpose: doing `NextAuth(authConfig)`
// at module top-level in Edge runtime has caused `MIDDLEWARE_INVOCATION_FAILED`
// on Vercel during the v5 beta. Middleware only needs to decide whether to
// redirect; the real session validation still happens on every protected
// page/route via `await auth()` (which runs on Node and re-validates the JWT).
//
// So here we just look for the NextAuth session cookie — its presence is a
// strong hint the user is logged in; a malicious user crafting a fake cookie
// would still fail the server-side validation on the protected route.

import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = new Set<string>(["/", "/signin"]);

function isPublicApi(path: string): boolean {
  // The published MCP HTTP transport must stay open — AI clients call it.
  // The auth handlers obviously can't require auth.
  return path.startsWith("/api/auth") || path.startsWith("/api/mcp");
}

// NextAuth v5 cookie names. The `__Secure-` variant is used over HTTPS.
const SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
];

function hasSessionCookie(req: NextRequest): boolean {
  for (const name of SESSION_COOKIE_NAMES) {
    const c = req.cookies.get(name);
    if (c?.value) return true;
  }
  return false;
}

export function middleware(req: NextRequest) {
  const { nextUrl } = req;
  const path = nextUrl.pathname;

  if (PUBLIC_PATHS.has(path) || isPublicApi(path)) {
    return NextResponse.next();
  }

  if (!hasSessionCookie(req)) {
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
}

export const config = {
  matcher: [
    // Skip Next.js internals, static assets, and the MCP runtime + auth
    // routes (handled via the allowlist above as well, but matching them
    // out at the regex level saves an invocation per request).
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\..*).*)",
  ],
};
