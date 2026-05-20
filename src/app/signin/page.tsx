/* Hallmark · pre-emit critique: P5 H4 E5 S4 R5 V5
 * theme: noir-cyan · genre: modern-minimal · scope: page (single-purpose)
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth, signIn } from "@/auth";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await auth();
  const { callbackUrl } = await searchParams;
  if (session?.user) {
    redirect(callbackUrl || "/builder");
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[color:var(--color-ink-0)] text-[color:var(--color-ink-text-1)]">
      <div className="noir-aurora" aria-hidden />

        <div className="relative z-10 mx-auto grid min-h-screen max-w-md place-items-center px-6">
          <div className="w-full rounded-3xl border border-[color:var(--color-ink-border)] bg-[color:var(--color-ink-1)] p-8 shadow-[0_30px_100px_-30px_oklch(0.30_0.18_280_/_0.55)]">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--color-ink-text-3)] hover:text-[color:var(--color-ink-text-1)]"
            >
              <ArrowLeft className="size-3" />
              Back
            </Link>

            <div className="mt-7 flex items-center gap-2">
              <span className="grid size-7 place-items-center rounded bg-[color:var(--color-ink-text-1)] text-xs font-bold text-[color:var(--color-ink-0)]">
                m
              </span>
              <span className="text-sm font-semibold tracking-tight text-[color:var(--color-ink-text-1)]">
                makemcp
              </span>
            </div>

            <h1 className="mt-7 text-2xl font-semibold tracking-tight text-[color:var(--color-ink-text-1)]">
              Sign in
            </h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-[color:var(--color-ink-text-2)]">
              Your projects, secrets, and published MCPs stay scoped to your
              account.
            </p>

            <form
              className="mt-7"
              action={async () => {
                "use server";
                await signIn("google", {
                  redirectTo: callbackUrl || "/builder",
                });
              }}
            >
              <button
                type="submit"
                className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-[color:var(--color-ink-text-1)] px-4 py-3 text-sm font-medium text-[color:var(--color-ink-0)] transition hover:bg-[oklch(0.92_0_0)] active:translate-y-px"
              >
                <GoogleMark />
                Continue with Google
              </button>
            </form>

            <p className="mt-6 text-[11px] leading-relaxed text-[color:var(--color-ink-text-3)]">
              By signing in you agree to our acceptable-use policy.
              Public-sector pilots may sign a custom DPA on request.
            </p>
          </div>
        </div>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.75h3.57c2.08-1.92 3.28-4.74 3.28-8.07z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.75c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.12A6.6 6.6 0 0 1 5.5 12c0-.74.13-1.45.34-2.12V7.04H2.18A11 11 0 0 0 1 12c0 1.78.43 3.46 1.18 4.96l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.04l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
        fill="#EA4335"
      />
    </svg>
  );
}
