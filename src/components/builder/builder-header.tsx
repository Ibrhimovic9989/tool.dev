"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Plug,
  Download,
  Rocket,
  ArrowLeft,
  Save,
  Loader2,
  Folder,
  Activity,
  KeyRound,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useBuilder, useCurrentProject } from "@/lib/store";
import { toast } from "sonner";
import { TestPanel } from "./test-panel";
import { UserMenu } from "./user-menu";
import { useSession } from "next-auth/react";

export function BuilderHeader() {
  const project = useCurrentProject();
  const renameProject = useBuilder((s) => s.renameProject);
  const { data: session } = useSession();
  const [exporting, setExporting] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);

  if (!project) return null;

  const doDownload = async (includeSecrets: boolean) => {
    setExporting(true);
    try {
      const res = await fetch(`/api/export`, {
        method: "POST",
        body: JSON.stringify({ project, includeSecrets }),
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${project.name.replace(/[^a-z0-9_-]+/gi, "_")}-mcp.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(
        includeSecrets
          ? "Downloaded with .env baked in"
          : "Server code downloaded",
      );
      setDownloadOpen(false);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Couldn't generate code package",
      );
    } finally {
      setExporting(false);
    }
  };

  const handleExport = () => {
    const secretCount = Object.keys(project.secrets ?? {}).length;
    if (secretCount === 0) {
      // Nothing to bake; go straight to download with a placeholder .env.example
      doDownload(false);
    } else {
      setDownloadOpen(true);
    }
  };

  const handleDeploy = async () => {
    setDeploying(true);
    try {
      const res = await fetch(`/api/deploy`, {
        method: "POST",
        body: JSON.stringify({ project }),
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Deploy failed");
      toast.success("Published", {
        description: `Available at ${data.url}`,
      });
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Couldn't deploy server",
      );
    } finally {
      setDeploying(false);
    }
  };

  const validNodes = project.nodes.filter((n) => n.data.status === "ready").length;

  return (
    <header className="flex h-14 items-center justify-between border-b bg-white px-4">
      <div className="flex items-center gap-3 min-w-0">
        <Link
          href="/"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div className="grid size-7 place-items-center rounded-md bg-gov-600 text-white">
          <Plug className="size-4" />
        </div>
        <Input
          value={project.name}
          onChange={(e) => renameProject(project.id, e.target.value)}
          className="h-8 max-w-xs border-0 px-2 text-sm font-semibold shadow-none focus-visible:ring-1"
        />
        <Badge variant="outline" className="hidden sm:inline-flex">
          {validNodes} ready / {project.nodes.length} total
        </Badge>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/servers">
            <Folder className="size-4" />
            My servers
          </Link>
        </Button>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Save className="size-3.5" />
          Saved on this device
        </div>
        <Button variant="outline" size="sm" onClick={() => setTestOpen(true)}>
          <Activity className="size-4" />
          Test
        </Button>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
          {exporting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          Download code
        </Button>
        <Button size="sm" onClick={handleDeploy} disabled={deploying}>
          {deploying ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Rocket className="size-4" />
          )}
          Publish
        </Button>
        <UserMenu
          name={session?.user?.name}
          email={session?.user?.email}
          image={session?.user?.image}
        />
      </div>
      <TestPanel open={testOpen} onOpenChange={setTestOpen} />
      <DownloadDialog
        open={downloadOpen}
        onOpenChange={setDownloadOpen}
        secretCount={Object.keys(project.secrets ?? {}).length}
        exporting={exporting}
        onChoose={doDownload}
      />
    </header>
  );
}

function DownloadDialog({
  open,
  onOpenChange,
  secretCount,
  exporting,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  secretCount: number;
  exporting: boolean;
  onChoose: (includeSecrets: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="size-4" />
            Download your MCP server
          </DialogTitle>
          <DialogDescription>
            You have <strong>{secretCount}</strong> secret
            {secretCount === 1 ? "" : "s"} saved in the builder. Choose whether
            to bake them into the downloaded code.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 mt-2">
          <button
            onClick={() => onChoose(true)}
            disabled={exporting}
            className="text-left rounded-lg border p-4 hover:bg-muted/50 disabled:opacity-50"
          >
            <div className="flex items-center gap-2 font-semibold">
              <KeyRound className="size-4 text-gov-600" />
              Ready-to-run (recommended for pilots)
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Includes a pre-filled <code>.env</code>. Run{" "}
              <code>npm install</code> and <code>npm run dev</code> — no other
              setup. <code>.gitignore</code> excludes <code>.env</code> so it
              won&apos;t be committed by accident.
            </p>
          </button>

          <button
            onClick={() => onChoose(false)}
            disabled={exporting}
            className="text-left rounded-lg border p-4 hover:bg-muted/50 disabled:opacity-50"
          >
            <div className="flex items-center gap-2 font-semibold">
              <ShieldAlert className="size-4 text-amber-700" />
              Template only (for sharing or production)
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Includes <code>.env.example</code> with placeholders. You or your
              IT team set the real values on the server. Safer for git, sharing,
              and procurement reviews.
            </p>
          </button>
        </div>

        {exporting && (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Preparing your zip…
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
