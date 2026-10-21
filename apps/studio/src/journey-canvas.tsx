import { useCallback, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import type { JourneyInfo } from "../../../packages/studio-server/src/contracts.js";
import { journeyGraph, journeyPositions } from "./journey-graph.js";

/**
 * The journey canvas.
 *
 * It draws what the journey declares. It does not execute anything, because a journey
 * owns no behavior: it points at the pages and the operations that already exist.
 */

const NODE_WIDTH = 190;
const NODE_HEIGHT = 64;

const KIND_BORDER: Record<string, string> = {
  page: "#27251f",
  operation: "#a33819",
  annotation: "#625b50",
};

function JourneyNodeView({ data }: NodeProps) {
  const node = data.node as { label: string; kind: string; detail: string };
  return (
    <div
      style={{
        width: NODE_WIDTH,
        minHeight: NODE_HEIGHT,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 2,
        padding: "0.5rem 0.75rem",
        border: `1px solid ${KIND_BORDER[node.kind] ?? "#27251f"}`,
        borderRadius: 4,
        background: "#fffdf8",
        color: "#27251f",
        font: "12px system-ui",
      }}
    >
      <strong>{node.label}</strong>
      <span style={{ color: "#625b50", fontSize: "11px" }}>{node.detail}</span>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { journey: JourneyNodeView };

export interface JourneyCanvasProps {
  journey: JourneyInfo;
  onSelectStep?: (step: string) => void;
  /**
   * Called when a person connects two steps.
   *
   * The canvas proposes the connection; the host decides whether it is allowed, because
   * a link has to name where the connection is realized, and only the host knows the
   * pages and the operations that exist.
   */
  onConnect?: (from: string, to: string) => void;
  /** Called when a person removes a step or a link. */
  onRemove?: (kind: "step" | "link", id: string) => void;
}

export function JourneyCanvas({ journey, onSelectStep, onConnect, onRemove }: JourneyCanvasProps) {
  const graph = useMemo(() => journeyGraph(journey), [journey]);
  const positions = useMemo(() => journeyPositions(graph), [graph]);
  const [nodes, setNodes] = useState<Node[]>(() =>
    graph.nodes.map((node) => ({
      id: node.id,
      type: "journey",
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      data: { node },
    })),
  );
  const [edges, setEdges] = useState<Edge[]>(() =>
    graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      label: edge.label,
    })),
  );

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((current) => applyEdgeChanges(changes, current));
  }, []);

  if (!graph.nodes.length) {
    return (
      <p className="muted" role="status">
        This journey declares no steps, so there is nothing to draw.
      </p>
    );
  }

  return (
    <div style={{ width: "100%", height: 420 }} aria-label={`${journey.name} journey`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => onSelectStep?.(node.id)}
        onConnect={(connection) => {
          if (connection.source && connection.target) onConnect?.(connection.source, connection.target);
        }}
        onEdgesDelete={(removed) => {
          for (const edge of removed) onRemove?.("link", edge.id);
        }}
        onNodesDelete={(removed) => {
          for (const node of removed) onRemove?.("step", node.id);
        }}
        nodeTypes={nodeTypes}
        deleteKeyCode={["Backspace", "Delete"]}
        fitView
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export function JourneyCanvasHost(props: JourneyCanvasProps) {
  return (
    <ReactFlowProvider>
      <JourneyCanvas {...props} />
    </ReactFlowProvider>
  );
}
