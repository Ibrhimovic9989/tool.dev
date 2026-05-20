"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { nanoid } from "nanoid";
import type {
  McpProject,
  McpNode,
  McpEdge,
  NodeKind,
  NodeData,
} from "./types";
import { createNode, blankProject } from "./factory";

interface State {
  projects: Record<string, McpProject>;
  currentProjectId: string | null;
  selectedNodeId: string | null;
}

interface Actions {
  // Project lifecycle
  newProject: (name?: string) => string;
  openProject: (id: string) => void;
  deleteProject: (id: string) => void;
  renameProject: (id: string, name: string) => void;
  updateProjectMeta: (id: string, patch: Partial<Pick<McpProject, "name" | "agency" | "description">>) => void;

  // Graph editing
  addNode: (kind: NodeKind, position: { x: number; y: number }) => string;
  removeNode: (nodeId: string) => void;
  moveNode: (nodeId: string, position: { x: number; y: number }) => void;
  updateNodeData: (nodeId: string, patch: Partial<NodeData>) => void;
  connect: (source: string, target: string) => void;
  removeEdge: (edgeId: string) => void;
  setNodes: (nodes: McpNode[]) => void;
  setEdges: (edges: McpEdge[]) => void;

  selectNode: (nodeId: string | null) => void;

  // Project-wide secret values (env var name -> value). Stored on device.
  setSecret: (envVarName: string, value: string) => void;
  removeSecret: (envVarName: string) => void;
  setSecretsBulk: (entries: Record<string, string>) => void;

  /** Replace the current project wholesale (used by the agent after a turn). */
  replaceProject: (project: McpProject) => void;
}

const useBuilder = create<State & Actions>()(
  persist(
    (set, get) => ({
      projects: {},
      currentProjectId: null,
      selectedNodeId: null,

      newProject: (name = "Untitled MCP") => {
        const project = blankProject(name);
        set((s) => ({
          projects: { ...s.projects, [project.id]: project },
          currentProjectId: project.id,
          selectedNodeId: null,
        }));
        return project.id;
      },

      openProject: (id) => set({ currentProjectId: id, selectedNodeId: null }),

      deleteProject: (id) =>
        set((s) => {
          const { [id]: _, ...rest } = s.projects;
          return {
            projects: rest,
            currentProjectId:
              s.currentProjectId === id ? null : s.currentProjectId,
          };
        }),

      renameProject: (id, name) =>
        set((s) => {
          const p = s.projects[id];
          if (!p) return s;
          return {
            projects: {
              ...s.projects,
              [id]: { ...p, name, updatedAt: Date.now() },
            },
          };
        }),

      updateProjectMeta: (id, patch) =>
        set((s) => {
          const p = s.projects[id];
          if (!p) return s;
          return {
            projects: {
              ...s.projects,
              [id]: { ...p, ...patch, updatedAt: Date.now() },
            },
          };
        }),

      addNode: (kind, position) => {
        const id = get().currentProjectId;
        if (!id) return "";
        const node = createNode(kind, position);
        set((s) => {
          const p = s.projects[id];
          if (!p) return s;
          return {
            projects: {
              ...s.projects,
              [id]: {
                ...p,
                nodes: [...p.nodes, node],
                updatedAt: Date.now(),
              },
            },
            selectedNodeId: node.id,
          };
        });
        return node.id;
      },

      removeNode: (nodeId) =>
        set((s) => {
          const pid = s.currentProjectId;
          if (!pid) return s;
          const p = s.projects[pid];
          if (!p) return s;
          return {
            projects: {
              ...s.projects,
              [pid]: {
                ...p,
                nodes: p.nodes.filter((n) => n.id !== nodeId),
                edges: p.edges.filter(
                  (e) => e.source !== nodeId && e.target !== nodeId,
                ),
                updatedAt: Date.now(),
              },
            },
            selectedNodeId:
              s.selectedNodeId === nodeId ? null : s.selectedNodeId,
          };
        }),

      moveNode: (nodeId, position) =>
        set((s) => {
          const pid = s.currentProjectId;
          if (!pid) return s;
          const p = s.projects[pid];
          if (!p) return s;
          return {
            projects: {
              ...s.projects,
              [pid]: {
                ...p,
                nodes: p.nodes.map((n) =>
                  n.id === nodeId ? { ...n, position } : n,
                ),
              },
            },
          };
        }),

      updateNodeData: (nodeId, patch) =>
        set((s) => {
          const pid = s.currentProjectId;
          if (!pid) return s;
          const p = s.projects[pid];
          if (!p) return s;
          return {
            projects: {
              ...s.projects,
              [pid]: {
                ...p,
                nodes: p.nodes.map((n) =>
                  n.id === nodeId
                    ? ({ ...n, data: { ...n.data, ...patch } as NodeData })
                    : n,
                ),
                updatedAt: Date.now(),
              },
            },
          };
        }),

      connect: (source, target) =>
        set((s) => {
          const pid = s.currentProjectId;
          if (!pid || source === target) return s;
          const p = s.projects[pid];
          if (!p) return s;
          // Prevent duplicate edges
          if (
            p.edges.some((e) => e.source === source && e.target === target)
          ) {
            return s;
          }
          const edge: McpEdge = {
            id: `e_${nanoid(8)}`,
            source,
            target,
          };
          return {
            projects: {
              ...s.projects,
              [pid]: {
                ...p,
                edges: [...p.edges, edge],
                updatedAt: Date.now(),
              },
            },
          };
        }),

      removeEdge: (edgeId) =>
        set((s) => {
          const pid = s.currentProjectId;
          if (!pid) return s;
          const p = s.projects[pid];
          if (!p) return s;
          return {
            projects: {
              ...s.projects,
              [pid]: {
                ...p,
                edges: p.edges.filter((e) => e.id !== edgeId),
                updatedAt: Date.now(),
              },
            },
          };
        }),

      setNodes: (nodes) =>
        set((s) => {
          const pid = s.currentProjectId;
          if (!pid) return s;
          const p = s.projects[pid];
          if (!p) return s;
          return {
            projects: {
              ...s.projects,
              [pid]: { ...p, nodes, updatedAt: Date.now() },
            },
          };
        }),

      setEdges: (edges) =>
        set((s) => {
          const pid = s.currentProjectId;
          if (!pid) return s;
          const p = s.projects[pid];
          if (!p) return s;
          return {
            projects: {
              ...s.projects,
              [pid]: { ...p, edges, updatedAt: Date.now() },
            },
          };
        }),

      selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

      setSecret: (envVarName, value) =>
        set((s) => {
          const pid = s.currentProjectId;
          if (!pid) return s;
          const p = s.projects[pid];
          if (!p) return s;
          if (!envVarName) return s;
          return {
            projects: {
              ...s.projects,
              [pid]: {
                ...p,
                secrets: { ...p.secrets, [envVarName]: value },
                updatedAt: Date.now(),
              },
            },
          };
        }),

      removeSecret: (envVarName) =>
        set((s) => {
          const pid = s.currentProjectId;
          if (!pid) return s;
          const p = s.projects[pid];
          if (!p) return s;
          const { [envVarName]: _drop, ...rest } = p.secrets;
          return {
            projects: {
              ...s.projects,
              [pid]: { ...p, secrets: rest, updatedAt: Date.now() },
            },
          };
        }),

      setSecretsBulk: (entries) =>
        set((s) => {
          const pid = s.currentProjectId;
          if (!pid) return s;
          const p = s.projects[pid];
          if (!p) return s;
          return {
            projects: {
              ...s.projects,
              [pid]: {
                ...p,
                secrets: { ...p.secrets, ...entries },
                updatedAt: Date.now(),
              },
            },
          };
        }),

      replaceProject: (project) =>
        set((s) => ({
          projects: {
            ...s.projects,
            [project.id]: project,
          },
          // Keep the currently-selected project consistent.
          currentProjectId:
            s.currentProjectId === project.id || !s.currentProjectId
              ? project.id
              : s.currentProjectId,
        })),
    }),
    {
      name: "makemcp-store-v1",
      storage: createJSONStorage(() => localStorage),
      version: 2,
      migrate: (persistedState, version) => {
        // v1 → v2: add empty `secrets` to every project so reads don't crash.
        const s = persistedState as State;
        if (version < 2 && s && s.projects) {
          for (const id of Object.keys(s.projects)) {
            const p = s.projects[id] as McpProject;
            if (!p.secrets) p.secrets = {};
          }
        }
        return s;
      },
    },
  ),
);

export { useBuilder };

export function useCurrentProject(): McpProject | null {
  return useBuilder((s) =>
    s.currentProjectId ? s.projects[s.currentProjectId] ?? null : null,
  );
}

export function useSelectedNode(): McpNode | null {
  return useBuilder((s) => {
    if (!s.currentProjectId || !s.selectedNodeId) return null;
    const project = s.projects[s.currentProjectId];
    if (!project) return null;
    return project.nodes.find((n) => n.id === s.selectedNodeId) ?? null;
  });
}
