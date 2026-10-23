import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { containmentGraph, workflowGraph, type SpikeEdge, type SpikeNode } from "./fixture.js";
import { InteractionTimer, publish, type SpikeDriver } from "./protocol.js";

/**
 * Candidate B: a native SVG canvas.
 *
 * Nothing is installed, and everything a canvas needs is written here: the viewport
 * transform, hit testing, node dragging, selection, and the keyboard path. The point of
 * the spike is to measure what that costs, so the implementation is honest about its
 * scope: it has no connection handles, so linking is not something a pointer can start.
 */

const timer = new InteractionTimer();
const NODE_WIDTH = 160;
const NODE_HEIGHT = 48;
const GRID = 220;

function parentMap(edges: SpikeEdge[]): Map<string, string> {
  const parents = new Map<string, string>();
  for (const edge of edges) parents.set(edge.to, edge.from);
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
  const graphs = useMemo(() => ({ workflow: workflowGraph(), containment: containmentGraph() }), []);
  const [kind, setKind] = useState<"workflow" | "containment">("workflow");
  const [nodes, setNodes] = useState<SpikeNode[]>(graphs.workflow.nodes);
  const [edges, setEdges] = useState<SpikeEdge[]>(graphs.workflow.edges);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState({ x: 120, y: 90, scale: 0.6 });
  const drag = useRef<
    | {
        mode: "node" | "pan";
        id?: string;
        startX: number;
        startY: number;
        originX: number;
        originY: number;
        grabX: number;
        grabY: number;
        moved: boolean;
      }
    | null
  >(null);
  const mountStart = useRef(performance.now());
  const svg = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const graph = graphs[kind];
    setNodes(graph.nodes);
    setEdges(graph.edges);
    setSelected(null);
  }, [kind, graphs]);

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svg.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - view.x) / view.scale,
        y: (clientY - rect.top - view.y) / view.scale,
      };
    },
    [view],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      const id = (event.target as Element).getAttribute("data-spike-node");
      const world = toWorld(event.clientX, event.clientY);
      if (id) {
        const node = nodes.find((item) => item.id === id);
        if (!node) return;
        setSelected(id);
        drag.current = {
          mode: "node",
          id,
          startX: event.clientX,
          startY: event.clientY,
          originX: node.x,
          originY: node.y,
          grabX: world.x,
          grabY: world.y,
          moved: false,
        };
      } else {
        drag.current = {
          mode: "pan",
          startX: event.clientX,
          startY: event.clientY,
          originX: view.x,
          originY: view.y,
          grabX: 0,
          grabY: 0,
          moved: false,
        };
      }
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
    },
    [nodes, view, toWorld],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const state = drag.current;
      if (!state) return;
      const distance = Math.hypot(event.clientX - state.startX, event.clientY - state.startY);
      if (!state.moved && distance > 3) {
        state.moved = true;
      }
      if (state.mode === "node" && state.id) {
        const world = toWorld(event.clientX, event.clientY);
        setNodes((current) =>
          current.map((node) =>
            node.id === state.id
              ? { ...node, x: state.originX + (world.x - state.grabX), y: state.originY + (world.y - state.grabY) }
              : node,
          ),
        );
      } else if (state.mode === "pan") {
        setView((current) => ({
          ...current,
          x: state.originX + (event.clientX - state.startX),
          y: state.originY + (event.clientY - state.startY),
        }));
      }
    },
    [toWorld],
  );

  const onPointerUp = useCallback((event: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    (event.currentTarget as Element).releasePointerCapture(event.pointerId);
  }, []);

  const onWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    setView((current) => {
      const next = Math.min(4, Math.max(0.05, current.scale * factor));
      const rect = svg.current?.getBoundingClientRect();
      if (!rect) return { ...current, scale: next };
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      return {
        scale: next,
        x: pointerX - ((pointerX - current.x) / current.scale) * next,
        y: pointerY - ((pointerY - current.y) / current.scale) * next,
      };
    });
  }, []);

  // React attaches the wheel listener passively, which makes preventDefault a warning
  // and the page scroll behind the canvas. A canvas that scrolls the document under
  // the pointer is a defect, so the listener is registered here instead.
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
      const active = document.activeElement as HTMLElement | null;
      const id = active?.getAttribute("data-spike-node");
      if (!id) return;
      event.preventDefault();
      const step = event.shiftKey ? 40 : 8;
      setNodes((current) =>
        current.map((node) =>
          node.id === id
            ? {
                ...node,
                x: node.x + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0),
                y: node.y + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0),
              }
            : node,
        ),
      );
    },
    [],
  );

  useEffect(() => {
    const driver: SpikeDriver = {
      implementation: "native-svg",
      useGraph: (next) => setKind(next),
      nodePosition: (id) => {
        const node = nodes.find((item) => item.id === id);
        return node ? { x: node.x, y: node.y } : null;
      },
      attemptConnect: (from, to) => {
        const parents = parentMap(edges);
        if (kind === "containment" && isAncestor(parents, to, from)) {
          return { accepted: false, edges: edges.length, reason: "The target is an ancestor." };
        }
        setEdges((current) => [...current, { id: `probe-${current.length}`, from, to }]);
        return { accepted: true, edges: edges.length + 1 };
      },
      focusNode: (id) => {
        const element = document.querySelector<HTMLElement>(`[data-spike-node="${id}"]`);
        if (!element) return false;
        element.focus();
        return document.activeElement === element;
      },
      moveFocused: (dx, dy) => {
        const active = document.activeElement as HTMLElement | null;
        const id = active?.getAttribute("data-spike-node");
        if (!id) return false;
        setNodes((current) =>
          current.map((node) => (node.id === id ? { ...node, x: node.x + dx, y: node.y + dy } : node)),
        );
        return true;
      },
      facts: () => ({
        nodes: nodes.length,
        edges: edges.length,
        renderedNodes: document.querySelectorAll("[data-spike-node]").length,
        renderedEdges: document.querySelectorAll("[data-spike-edge]").length,
        tabbableNodes: document.querySelectorAll("[data-spike-node][tabindex]").length,
        connectionHandles: 0,
        mountMs: Math.round(performance.now() - mountStart.current),
      }),
      beginInteraction: (kind) => timer.begin(kind),
      endInteraction: (kind) => timer.end(kind),
      probe: () => ({
        nodeWrappers: document.querySelectorAll("[data-spike-node]").length,
        dataIdElements: document.querySelectorAll("[data-id]").length,
        focusableWrappers: document.querySelectorAll("[data-spike-node][tabindex]").length,
        activeTag: document.activeElement?.tagName ?? null,
        activeClass: document.activeElement?.getAttribute("class") ?? null,
        activeId: document.activeElement?.getAttribute("data-spike-node") ?? null,
      }),
      metrics: () => timer.summary(),
      resetMetrics: () => timer.reset(),
      ready: () => Boolean(document.querySelector("[data-spike-node]")),
    };
    onDriver(driver);
  }, [nodes, edges, kind, onDriver]);

  const positions = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }} onKeyDown={onKeyDown}>
      <svg
        ref={svg}
        width="100%"
        height="100%"
        style={{ display: "block", touchAction: "none", cursor: "grab" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        role="application"
        aria-label="Workflow graph canvas"
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          {edges.map((edge) => {
            const from = positions.get(edge.from);
            const to = positions.get(edge.to);
            if (!from || !to) return null;
            return (
              <line
                key={edge.id}
                data-spike-edge={edge.id}
                x1={from.x + NODE_WIDTH / 2}
                y1={from.y + NODE_HEIGHT / 2}
                x2={to.x + NODE_WIDTH / 2}
                y2={to.y + NODE_HEIGHT / 2}
                stroke="#625b50"
                strokeWidth={1.5}
              />
            );
          })}
          {nodes.map((node) => (
            <g key={node.id} transform={`translate(${node.x} ${node.y})`}>
              <rect
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={4}
                fill="#fffdf8"
                stroke={selected === node.id ? "#a33819" : "#27251f"}
                strokeWidth={selected === node.id ? 2 : 1}
              />
              <text
                data-spike-node={node.id}
                tabIndex={0}
                x={NODE_WIDTH / 2}
                y={NODE_HEIGHT / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={12}
                fill="#27251f"
                fontFamily="system-ui"
              >
                {node.label}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

function Root() {
  const [driver, setDriver] = useState<SpikeDriver | null>(null);
  const onDriver = useCallback((next: SpikeDriver) => setDriver(() => next), []);
  useEffect(() => {
    if (driver) publish(driver);
  }, [driver]);
  return <App onDriver={onDriver} />;
}

createRoot(document.getElementById("root")!).render(<Root />);
