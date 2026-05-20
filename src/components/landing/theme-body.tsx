"use client";

import { useEffect } from "react";

/** Toggles a class on <body> for the lifetime of a page. */
export function ThemeBody({ className }: { className: string }) {
  useEffect(() => {
    document.body.classList.add(className);
    return () => {
      document.body.classList.remove(className);
    };
  }, [className]);
  return null;
}
