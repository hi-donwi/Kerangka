import { useCallback, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  applyEdgeChanges,
  applyNodeChanges,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import type { EntityInfo } from "../../../packages/studio-server/src/contracts.js";
import { workflowGraph, workflowPositions } from "./workflow-graph.js";

/**
 * The workflow canvas.
 *
 * The canvas is the view; the model is the truth. Nothing here writes a state, a
 * transition, or a role: it draws what the model declares, lets a person move a node
 * to look at it more comfortably, and reports which state they picked. A drag
 * changes a position and nothing else.
 *
 * The module is loaded on demand, so the graph library is fetched when a person opens
 * a workflow and never reaches the engine, the compiler, or a normal application page.
 */

const NODE_WIDTH = 168;
const NODE_HEIGHT = 56;

function StateNode({ data }: NodeProps) {
  const state = data.state as { label: string; initial: boolean; terminal: boolean };
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
        border: `1px solid ${state.initial ? "#a33819" : "#27251f"}`,
        borderRadius: 4,
        background: "#fffdf8",
        color: "#27251f",
        font: "12px system-ui",
      }}
    >
      <strong>{state.label}</strong>
      <span style={{ color: "#625b50", fontSize: "11px" }}>
        {state.initial ? "initial" : state.terminal ? "terminal" : "state"}
      </span>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { state: StateNode };

export interface WorkflowCanvasProps {
  entity: EntityInfo;
  /** Called when a state is picked, so the console can show it. */
  onSelectState?: (state: string) => void;
  /** Called when a state is moved. The position is editor metadata, not behavior. */
  onMoveState?: (state: string, position: { x: number; y: number }) => void;
}

export function WorkflowCanvas({ entity, onSelectState, onMoveState }: WorkflowCanvasProps) {
  const graph = useMemo(() => workflowGraph(entity), [entity]);
  const positions = useMemo(() => workflowPositions(graph), [graph]);
  const [nodes, setNodes] = useState<Node[]>(() =>
    graph.states.map((state) => ({
      id: state.id,
      type: "state",
      position: positions.get(state.id) ?? { x: 0, y: 0 },
      data: { state },
    })),
  );
  const [edges, setEdges] = useState<Edge[]>(() =>
    graph.transitions.map((transition) => ({
      id: transition.id,
      source: transition.from,
      target: transition.to,
      label: transition.roles.length ? `${transition.label} (${transition.roles.join(", ")})` : transition.label,
      animated: false,
    })),
  );

  // The changes are applied to the current nodes. A change is not a node, and handing
  // one to the canvas as if it were would leave the canvas without positions.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((current) => applyNodeChanges(changes, current));
      for (const change of changes) {
        if (change.type !== "position" || !change.position) continue;
        onMoveState?.(change.id, change.position);
      }
    },
    [onMoveState],
  );

  if (!graph.states.length) {
    return (
      <p className="muted" role="status">
        This entity declares no workflow, so there is nothing to draw.
      </p>
    );
  }

  return (
    <div style={{ width: "100%", height: 420 }} aria-label={`${entity.name} workflow`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={(changes) => setEdges((current) => applyEdgeChanges(changes, current))}
        onNodeClick={(_, node) => onSelectState?.(node.id)}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}

export function WorkflowCanvasHost(props: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvas {...props} />
    </ReactFlowProvider>
  );
}
