import { Suspense } from "react";
import { BuilderShell } from "@/components/builder/builder-shell";

export default function BuilderPage() {
  return (
    <Suspense fallback={<div className="p-10">Loading builder…</div>}>
      <BuilderShell />
    </Suspense>
  );
}
