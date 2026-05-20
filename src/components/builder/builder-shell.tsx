"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useBuilder, useCurrentProject } from "@/lib/store";
import { BuilderHeader } from "./builder-header";
import { Canvas } from "./canvas";
import { ConfigPanel } from "./config-panel";
import { ChatPanel } from "@/components/agent/chat-panel";
import type { McpProject } from "@/lib/types";

export function BuilderShell() {
  const router = useRouter();
  const params = useSearchParams();
  const requestedId = params.get("p");

  const projects = useBuilder((s) => s.projects);
  const currentProjectId = useBuilder((s) => s.currentProjectId);
  const openProject = useBuilder((s) => s.openProject);
  const newProject = useBuilder((s) => s.newProject);
  const replaceProject = useBuilder((s) => s.replaceProject);
  const project = useCurrentProject();

  useEffect(() => {
    if (requestedId && projects[requestedId]) {
      if (currentProjectId !== requestedId) openProject(requestedId);
      return;
    }
    if (currentProjectId && projects[currentProjectId]) {
      router.replace(`/builder?p=${currentProjectId}`, { scroll: false });
      return;
    }
    // Before fabricating a fresh "My first MCP", reuse the most recent empty
    // one if it exists. Stops the page from minting a new project on every
    // visit when no `?p=` is in the URL.
    const empty = Object.values(projects)
      .filter(
        (p) => p.nodes.filter((n) => n.data.kind !== "output.mcp").length === 0,
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (empty) {
      openProject(empty.id);
      router.replace(`/builder?p=${empty.id}`, { scroll: false });
      return;
    }
    const id = newProject("Untitled MCP");
    router.replace(`/builder?p=${id}`, { scroll: false });
  }, [requestedId, currentProjectId, projects, openProject, newProject, router]);

  if (!currentProjectId || !projects[currentProjectId]) {
    return <div className="p-10">Setting up your canvas…</div>;
  }

  const handleProjectChange = (p: McpProject | null) => {
    if (p) replaceProject(p);
  };

  return (
    <div className="theme-noir flex h-screen flex-col bg-background text-foreground">
      <BuilderHeader />
      <div className="grid flex-1 grid-cols-[420px_1fr_380px] overflow-hidden">
        <ChatPanel
          localProject={project}
          onProjectChange={handleProjectChange}
        />
        <Canvas />
        <ConfigPanel />
      </div>
    </div>
  );
}
