import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ContextAtlasNode, ContextAtlasSnapshot, ContextAtlasView } from "./context-atlas.js";

type ContextFlowNode = Node<{ item: ContextAtlasNode }>;

function ContextMapNode({ data, selected }: NodeProps) {
  const { item } = data as { item: ContextAtlasNode };
  return (
    <article className="context-map-node" data-selected={selected}>
      <span className="context-map-node-kind">{item.kind}</span>
      <strong>{item.label}</strong>
      <span className="context-map-node-summary">
        {item.details?.fields?.length
          ? `${item.details.fields.length} fields`
          : item.details?.notes?.[0] ?? item.description}
      </span>
      <Handle type="target" position={Position.Left} className="context-map-handle" />
      <Handle type="source" position={Position.Right} className="context-map-handle" />
    </article>
  );
}

const nodeTypes = { context: ContextMapNode };

function columnFor(kind: ContextAtlasNode["kind"]): number {
  if (kind === "module") return 0;
  if (kind === "operation") return 2;
  return 1;
}

function ContextCanvas({ snapshot, onOpenSource }: {
  snapshot: ContextAtlasSnapshot;
  onOpenSource?: (path: string) => void;
}) {
  const graphElement = useRef<HTMLDivElement>(null);
  const { fitView } = useReactFlow();
  const [activeViewId, setActiveViewId] = useState(snapshot.views[0]?.id ?? "");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const activeView = snapshot.views.find((view) => view.id === activeViewId) ?? snapshot.views[0];
  const visibleIds = useMemo(() => new Set(activeView?.nodeIds ?? []), [activeView]);
  const visibleNodes = useMemo(
    () => snapshot.nodes.filter((node) => visibleIds.has(node.id)),
    [snapshot.nodes, visibleIds],
  );
  const nodes = useMemo(() => {
    const rows = new Map<number, number>();
    const ordered = [...visibleNodes].sort((left, right) =>
      columnFor(left.kind) - columnFor(right.kind) || left.label.localeCompare(right.label),
    );
    return ordered.map((item): ContextFlowNode => {
      const column = columnFor(item.kind);
      const row = rows.get(column) ?? 0;
      rows.set(column, row + 1);
      return {
        id: item.id,
        type: "context",
        position: { x: column * 280, y: row * 118 },
        data: { item },
        selected: item.id === selectedNodeId,
        draggable: false,
        selectable: true,
      };
    });
  }, [visibleNodes, selectedNodeId]);
  const edges = useMemo(() => snapshot.edges
    .filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target))
    .map((edge): Edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label || edge.relation,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: "var(--color-border-strong, #817a70)", strokeWidth: 1.5 },
      labelStyle: { fill: "var(--color-text-muted, #625b50)", fontSize: 10 },
    })), [snapshot.edges, visibleIds]);
  const selectedNode = snapshot.nodes.find((node) => node.id === selectedNodeId && visibleIds.has(node.id));
  const sources = selectedNode?.sourceIds
    .map((id) => snapshot.sources.find((source) => source.id === id))
    .filter((source): source is NonNullable<typeof source> => Boolean(source)) ?? [];

  const refitGraph = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => void fitView({ padding: 0.2, minZoom: 0.15, maxZoom: 1.6 }));
    });
  }, [fitView]);

  useEffect(() => {
    refitGraph();
  }, [activeView?.id, visibleNodes.length, refitGraph]);

  useEffect(() => {
    const element = graphElement.current;
    if (!element) return;
    const observer = new ResizeObserver(refitGraph);
    observer.observe(element);
    window.addEventListener("resize", refitGraph);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", refitGraph);
    };
  }, [refitGraph]);

  const onViewKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % snapshot.views.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + snapshot.views.length) % snapshot.views.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = snapshot.views.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    const nextView = snapshot.views[nextIndex];
    if (!nextView) return;
    setActiveViewId(nextView.id);
    setSelectedNodeId(null);
    document.getElementById(`context-view-tab-${nextIndex}`)?.focus();
  };

  return (
    <div className="context-atlas">
      <div className="context-atlas-heading">
        <div>
          <p className="eyebrow">project context</p>
          <h2>{snapshot.project.name}</h2>
        </div>
        <span className="snapshot-id" title={snapshot.project.version}>
          {snapshot.nodes.length} items · read only
        </span>
      </div>
      <p className="context-atlas-note">
        This map shows declared project metadata. It does not include source contents, preview records, or write actions.
      </p>
      <div className="output-tabs context-atlas-tabs" role="tablist" aria-label="Context view">
        {snapshot.views.map((view: ContextAtlasView, index) => (
          <button
            key={view.id}
            id={`context-view-tab-${index}`}
            type="button"
            role="tab"
            aria-selected={activeView?.id === view.id}
            aria-controls="context-map-panel"
            title={view.description}
            tabIndex={activeView?.id === view.id ? 0 : -1}
            onKeyDown={(event) => onViewKeyDown(event, index)}
            onClick={() => {
              setActiveViewId(view.id);
              setSelectedNodeId(null);
            }}
          >
            {view.label}
          </button>
        ))}
      </div>
      <div
        className="context-atlas-layout"
        id="context-map-panel"
        role="tabpanel"
        aria-labelledby={`context-view-tab-${snapshot.views.findIndex((view) => view.id === activeView?.id)}`}
        tabIndex={0}
      >
        <div
          ref={graphElement}
          className="context-atlas-graph"
          role="region"
          aria-label={`${activeView?.label ?? "Context"} map`}
        >
          {visibleNodes.length ? (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodeClick={(_, node) => setSelectedNodeId(node.id)}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
              deleteKeyCode={null}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.2}
              maxZoom={1.6}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="var(--color-border, #d8d1c6)" gap={22} size={1} />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable nodeColor="#a33819" />
            </ReactFlow>
          ) : (
            <div className="empty-state">
              <h3>No items in this view.</h3>
              <p>The current inspection does not declare content for this perspective.</p>
            </div>
          )}
        </div>
        <aside className="context-atlas-inspector" aria-label="Context item details">
          {selectedNode ? (
            <>
              <p className="eyebrow">{selectedNode.kind}</p>
              <h3>{selectedNode.label}</h3>
              <p>{selectedNode.description}</p>
              {selectedNode.details?.fields?.length ? (
                <div>
                  <h4>Fields</h4>
                  <ul className="context-atlas-details-list">
                    {selectedNode.details.fields.map((field) => (
                      <li key={field.name}>
                        <strong>{field.name}</strong>
                        <span>{field.type}{field.required ? " · required" : ""}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {selectedNode.details?.notes?.length ? (
                <div>
                  <h4>Declared details</h4>
                  <ul className="context-atlas-details-list">
                    {selectedNode.details.notes.map((note) => <li key={note}>{note}</li>)}
                  </ul>
                </div>
              ) : null}
              <div>
                <h4>Source references</h4>
                {sources.length ? (
                  <ul className="context-atlas-details-list">
                    {sources.map((source) => (
                      <li key={source.id}>
                        {onOpenSource ? (
                          <button type="button" onClick={() => onOpenSource(source.path)}>
                            Open <code>{source.path}</code>
                          </button>
                        ) : <code>{source.path}</code>}
                      </li>
                    ))}
                  </ul>
                ) : <p className="muted">No source reference is available.</p>}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <h3>Select a map item</h3>
              <p>Its declared fields and source references will appear here.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

export function ContextCanvasHost({ snapshot, onOpenSource }: {
  snapshot: ContextAtlasSnapshot;
  onOpenSource?: (path: string) => void;
}) {
  return (
    <ReactFlowProvider>
      <ContextCanvas snapshot={snapshot} onOpenSource={onOpenSource} />
    </ReactFlowProvider>
  );
}
