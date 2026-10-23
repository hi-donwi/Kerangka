import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { containmentGraph, workflowGraph } from "./fixture.js";
import { InteractionTimer, publish, type SpikeDriver } from "./protocol.js";

/**
 * Candidate A: the graph library, in controlled mode.
 *
 * Controlled mode is the requirement from ADR-0049: the host owns the node and edge
 * state, so the canvas cannot become a second copy of the document. The candidate is
 * measured on the same fixture and the same events as the native canvas.
 */

const timer = new InteractionTimer();
const NODE_WIDTH = 160;
const NODE_HEIGHT = 48;

function SpikeNode({ data }: NodeProps) {
  return (
    <div
      data-spike-node={String(data.id)}
      tabIndex={0}
      style={{
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "1px solid #27251f",
        borderRadius: 4,
        background: "#fffdf8",
        font: "12px system-ui",
        color: "#27251f",
      }}
    >
      <Handle type="target" position={Position.Left} />
      {String(data.label)}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { spike: SpikeNode };

function toNodes(graph: { nodes: Array<{ id: string; x: number; y: number; label: string }> }): Node[] {
  return graph.nodes.map((node) => ({
    id: node.id,
    type: "spike",
    position: { x: node.x, y: node.y },
    data: { id: node.id, label: node.label },
  }));
}

function toEdges(graph: { edges: Array<{ id: string; from: string; to: string }> }): Edge[] {
  return graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    data: { label: edge.id },
  }));
}

/** A containment tree: a target that is already an ancestor may not be a child. */
function parentMap(edges: Edge[]): Map<string, string> {
  const parents = new Map<string, string>();
  for (const edge of edges) parents.set(edge.target, edge.source);
  return parents;
}

function isAncestor(parents: Map<string, string>, ancestor: string, node: string): boolean {
  let current = node;
  for (let depth = 0; depth < 64; depth++) {
    const parent = parents.get(current);
    if (!parent) return false;
    if (parent === ancestor) return true;
    current = parent;
  }
  return false;
}

function App({ onDriver }: { onDriver: (driver: SpikeDriver) => void }) {
  const [kind, setKind] = useState<"workflow" | "containment">("workflow");
  const graphs = useMemo(
    () => ({ workflow: workflowGraph(), containment: containmentGraph() }),
    [],
  );
  const [nodes, setNodes] = useState<Node[]>(() => toNodes(graphs.workflow));
  const [edges, setEdges] = useState<Edge[]>(() => toEdges(graphs.workflow));
  const mountStart = useRef(performance.now());
  const container = useRef<HTMLDivElement>(null);


  useEffect(() => {
    const graph = graphs[kind];
    setNodes(toNodes(graph));
    setEdges(toEdges(graph));
  }, [kind, graphs]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((current) => applyEdgeChanges(changes, current));
  }, []);
  const onConnect = useCallback(
    (connection: Connection) => {
      if (kind === "containment" && connection.source && connection.target) {
        const parents = parentMap(edges);
        if (isAncestor(parents, connection.target, connection.source)) return;
      }
      setEdges((current) => addEdge({ ...connection, data: { label: connection.source } }, current));
    },
    [kind, edges],
  );

  // The keyboard path uses the library's own focus model: the node wrapper carries
  // `data-id`, and that is the element a person actually focuses.
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
      const active = document.activeElement as HTMLElement | null;
      const id =
        active?.closest(".react-flow__node")?.getAttribute("data-id") ??
        active?.closest("[data-spike-node]")?.getAttribute("data-spike-node");
      if (!id) return;
      const step = event.shiftKey ? 40 : 8;
      setNodes((current) =>
        current.map((node) =>
          node.id === id
            ? {
                ...node,
                position: {
                  x: node.position.x + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0),
                  y: node.position.y + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0),
                },
              }
            : node,
        ),
      );
    };
    element.addEventListener("keydown", onKeyDown, true);
    return () => element.removeEventListener("keydown", onKeyDown, true);
  }, []);

  useEffect(() => {
    const driver: SpikeDriver = {
      implementation: "react-flow",
      useGraph: (next) => setKind(next),
      nodePosition: (id) => {
        const node = nodes.find((item) => item.id === id);
        return node ? { x: node.position.x, y: node.position.y } : null;
      },
      attemptConnect: (from, to) => {
        const before = edges.length;
        const parents = parentMap(edges);
        if (kind === "containment" && isAncestor(parents, to, from)) {
          return { accepted: false, edges: before, reason: "The target is an ancestor." };
        }
        setEdges((current) =>
          addEdge({ id: `probe-${current.length}`, source: from, target: to, data: { label: "probe" } }, current),
        );
        return { accepted: true, edges: before + 1 };
      },
      focusNode: (id) => {
        const element =
          document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`) ??
          document.querySelector<HTMLElement>(`[data-spike-node="${id}"]`);
        if (!element) return false;
        element.focus();
        const active = document.activeElement as HTMLElement | null;
        if (!active) return false;
        return (
          active === element ||
          active.closest(".react-flow__node")?.getAttribute("data-id") === id ||
          active.closest("[data-spike-node]")?.getAttribute("data-spike-node") === id
        );
      },
      moveFocused: (dx, dy) => {
        const active = document.activeElement as HTMLElement | null;
        const id =
          active?.closest(".react-flow__node")?.getAttribute("data-id") ??
          active?.closest("[data-spike-node]")?.getAttribute("data-spike-node");
        if (!id) return false;
        setNodes((current) =>
          current.map((node) =>
            node.id === id
              ? { ...node, position: { x: node.position.x + dx, y: node.position.y + dy } }
              : node,
          ),
        );
        return true;
      },
      facts: () => ({
        nodes: nodes.length,
        edges: edges.length,
        renderedNodes: document.querySelectorAll("[data-spike-node]").length,
        renderedEdges: document.querySelectorAll(".react-flow__edge").length,
        tabbableNodes: document.querySelectorAll("[data-spike-node][tabindex]").length,
        connectionHandles: document.querySelectorAll(".react-flow__handle").length,
        mountMs: Math.round(performance.now() - mountStart.current),
      }),
      probe: () => ({
        nodeWrappers: document.querySelectorAll(".react-flow__node").length,
        dataIdElements: document.querySelectorAll("[data-id]").length,
        focusableWrappers: document.querySelectorAll(".react-flow__node[tabindex]").length,
        activeTag: document.activeElement?.tagName ?? null,
        activeClass: document.activeElement?.getAttribute("class") ?? null,
        activeId: document.activeElement?.closest("[data-id]")?.getAttribute("data-id") ?? null,
      }),
      beginInteraction: (kind) => timer.begin(kind),
      endInteraction: (kind) => timer.end(kind),
      metrics: () => timer.summary(),
      resetMetrics: () => timer.reset(),
      ready: () => Boolean(document.querySelector("[data-spike-node]")),
    };
    onDriver(driver);
  }, [nodes, edges, kind, onDriver]);

  return (
    <div ref={container} style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        defaultViewport={{ x: 120, y: 90, zoom: 0.6 }}
        minZoom={0.05}
        maxZoom={4}
        onlyRenderVisibleElements
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

function Root() {
  const [driver, setDriver] = useState<SpikeDriver | null>(null);
  const onDriver = useCallback((next: SpikeDriver) => setDriver(() => next), []);
  useEffect(() => {
    if (driver) publish(driver);
  }, [driver]);
  return (
    <ReactFlowProvider>
      <App onDriver={onDriver} />
    </ReactFlowProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Root />);
