"use client";

import { useCallback, useMemo, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Node as RFNode,
  type Edge as RFEdge,
  type Connection,
  type NodeChange,
  type EdgeChange,
  useReactFlow,
} from "@xyflow/react";
import { useBuilder, useCurrentProject } from "@/lib/store";
import type { NodeKind } from "@/lib/types";
import { McpFlowNode } from "./flow-node";

const nodeTypes = {
  "source.rest": McpFlowNode,
  "source.database": McpFlowNode,
  "source.documents": McpFlowNode,
  "source.webpage": McpFlowNode,
  "output.mcp": McpFlowNode,
};

export function Canvas() {
  return (
    <ReactFlowProvider>
      <InnerCanvas />
    </ReactFlowProvider>
  );
}

function InnerCanvas() {
  const project = useCurrentProject();
  const moveNode = useBuilder((s) => s.moveNode);
  const removeNode = useBuilder((s) => s.removeNode);
  const removeEdge = useBuilder((s) => s.removeEdge);
  const connect = useBuilder((s) => s.connect);
  const addNode = useBuilder((s) => s.addNode);
  const selectNode = useBuilder((s) => s.selectNode);
  const selectedNodeId = useBuilder((s) => s.selectedNodeId);

  const wrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const rfNodes: RFNode[] = useMemo(() => {
    if (!project) return [];
    return project.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: { node: n, selected: n.id === selectedNodeId },
      selected: n.id === selectedNodeId,
    }));
  }, [project, selectedNodeId]);

  const rfEdges: RFEdge[] = useMemo(() => {
    if (!project) return [];
    return project.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      animated: true,
      style: { stroke: "rgb(29 78 216)", strokeWidth: 2 },
    }));
  }, [project]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const next = applyNodeChanges(changes, rfNodes);
      // Apply position updates back to the store
      changes.forEach((c) => {
        if (c.type === "position" && c.position && c.id) {
          moveNode(c.id, c.position);
        }
        if (c.type === "remove") {
          removeNode(c.id);
        }
      });
      // (no-op to satisfy "applyNodeChanges" usage and types)
      void next;
    },
    [rfNodes, moveNode, removeNode],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      changes.forEach((c) => {
        if (c.type === "remove") removeEdge(c.id);
      });
      void applyEdgeChanges(changes, rfEdges);
    },
    [rfEdges, removeEdge],
  );

  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return;
      connect(params.source, params.target);
      // applies locally to keep react-flow happy (store is source of truth)
      void addEdge(params, rfEdges);
    },
    [connect, rfEdges],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const kind = e.dataTransfer.getData("application/makemcp-node") as
        | NodeKind
        | "";
      if (!kind) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addNode(kind, position);
    },
    [addNode, screenToFlowPosition],
  );

  return (
    <div ref={wrapper} className="relative h-full w-full canvas-bg" onDrop={onDrop} onDragOver={onDragOver}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => selectNode(node.id)}
        onPaneClick={() => selectNode(null)}
        fitView
        proOptions={{ hideAttribution: true }}
        minZoom={0.4}
        maxZoom={1.5}
        defaultEdgeOptions={{ animated: true }}
      >
        <Background gap={18} size={1.4} color="oklch(1 0 0 / 0.06)" />
        <Controls className="!border" />
        <MiniMap pannable zoomable className="!border" />
      </ReactFlow>

      {project && project.nodes.length <= 1 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="pointer-events-auto max-w-sm rounded-xl border bg-card/95 p-6 text-center shadow-md">
            <h3 className="font-semibold">Tell the agent what to build</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Use the chat panel on the left. Describe what you need or paste
              a connection string — the agent will wire up the blocks.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
