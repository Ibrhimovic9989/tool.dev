"use client";

import { useEffect, useRef, useState } from "react";
import { LogOut, User } from "lucide-react";
import { signOut } from "next-auth/react";

interface Props {
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

export function UserMenu({ name, email, image }: Props) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const initial =
    (name?.trim()?.[0] || email?.trim()?.[0] || "?").toUpperCase();

  return (
    <div ref={wrapper} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex size-8 items-center justify-center rounded-full border border-[color:var(--color-ink-border)] bg-[color:var(--color-ink-1)] text-xs font-semibold text-[color:var(--color-ink-text-1)] hover:border-[color:var(--color-ink-border-strong)] overflow-hidden"
        title={email ?? undefined}
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" className="size-full object-cover" />
        ) : (
          <span>{initial}</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-60 overflow-hidden rounded-xl border border-[color:var(--color-ink-border)] bg-[color:var(--color-ink-1)] shadow-[0_20px_60px_-20px_oklch(0_0_0_/_0.6)] z-50">
          <div className="border-b border-[color:var(--color-ink-border)] px-3 py-2.5">
            <div className="truncate text-sm font-medium text-[color:var(--color-ink-text-1)]">
              {name || "Signed in"}
            </div>
            <div className="truncate text-xs text-[color:var(--color-ink-text-3)]">
              {email}
            </div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/" })}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[color:var(--color-ink-text-2)] hover:bg-[color:var(--color-ink-2)] hover:text-[color:var(--color-ink-text-1)]"
          >
            <LogOut className="size-3.5" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function AnonymousBadge() {
  return (
    <a
      href="/signin"
      className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs text-muted-foreground hover:border-gov-500 hover:text-foreground"
    >
      <User className="size-3" />
      Sign in
    </a>
  );
}
