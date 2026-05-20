// Edge-safe slice of the Auth.js config. Middleware imports this so it can
// resolve providers and callbacks without pulling in node-postgres (which
// breaks on the Edge runtime).

import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

export const authConfig = {
  session: { strategy: "jwt" },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.uid = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token.uid && session.user) {
        (session.user as { id?: string }).id = String(token.uid);
      }
      return session;
    },
  },
  pages: { signIn: "/signin" },
} satisfies NextAuthConfig;
