import { lazy, Suspense, useMemo, useState } from "react";
import { defaultRegistry, type WidgetManifest } from "uidl-runtime";
import type { Inspection, JourneyInfo, ScreenInfo } from "../../../packages/studio-server/src/contracts.js";
import { findDocumentNode, nodeSummary, WORKBENCH_MODES, type WorkbenchMode } from "./workbench-modes.js";

/**
 * The canvas is loaded on demand. The graph library is a big dependency, and a person
 * who never opens a workflow should never download it.
 */
const WorkflowCanvasHost = lazy(() => import("./workflow-canvas.js").then((module) => ({
  default: module.WorkflowCanvasHost,
})));

const JourneyCanvasHost = lazy(() => import("./journey-canvas.js").then((module) => ({
  default: module.JourneyCanvasHost,
})));

/**
 * The workbench views.
 *
 * The catalog is read from the runtime's own registry rather than a Studio copy, so a
 * component the runtime adds appears here without anyone editing this file, and a
 * component the runtime drops disappears with it.
 */

const CATEGORY_LABELS: Record<string, string> = {
  layout: "Layout",
  base: "Base",
  form: "Form",
  data: "Data",
  navigation: "Navigation",
  advanced: "Advanced",
};

export function ComponentCatalog({ limit = 40 }: { limit?: number }) {
  const [query, setQuery] = useState("");
  const widgets = useMemo(() => defaultRegistry.list().filter((widget) => !widget.hideFromPalette), []);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = needle
      ? widgets.filter((widget) => widget.type.toLowerCase().includes(needle) || widget.category.includes(needle))
      : widgets;
    return matching.slice(0, limit);
  }, [query, widgets, limit]);

  return (
    <section className="catalog-panel" aria-label="Component catalog">
      <div className="inspector-heading">
        <div>
          <p className="eyebrow">catalog</p>
          <h2>Components</h2>
        </div>
        <span className="snapshot-id">{filtered.length} of {widgets.length}</span>
      </div>
      <label className="field">
        <span>Search</span>
        <input
          type="search"
          value={query}
          placeholder="TextField, Button, layout"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <ul className="catalog-list">
        {filtered.map((widget: WidgetManifest) => (
          <li key={widget.type}>
            <strong>{widget.type}</strong>
            <span>{CATEGORY_LABELS[widget.category] ?? widget.category}</span>
            <span>{widget.acceptsChildren ? "container" : "leaf"}</span>
            {widget.propDescriptors?.length ? <span>{widget.propDescriptors.length} props</span> : null}
            {widget.events?.length ? <span>{widget.events.length} events</span> : null}
          </li>
        ))}
        {filtered.length === 0 ? <li className="muted">No component matches that search.</li> : null}
      </ul>
    </section>
  );
}

export function NodeInspector({ screen, nodeId }: { screen?: ScreenInfo; nodeId: string | null }) {
  if (!nodeId) {
    return (
      <section className="catalog-panel" aria-label="Node inspector">
        <p className="muted">Select a node in the preview to inspect it.</p>
      </section>
    );
  }
  const node = findDocumentNode(screen?.document, nodeId);
  if (!node) {
    return (
      <section className="catalog-panel" aria-label="Node inspector">
        <p className="muted" role="status">
          The selected node is not part of this document.
        </p>
      </section>
    );
  }
  const summary = nodeSummary(node);
  return (
    <section className="catalog-panel" aria-label="Node inspector">
      <div className="inspector-heading">
        <div>
          <p className="eyebrow">node</p>
          <h2>{summary.type}</h2>
        </div>
        <span className="snapshot-id">{summary.id}</span>
      </div>
      <dl className="node-facts">
        <dt>Type</dt>
        <dd>{summary.type}</dd>
        <dt>Properties</dt>
        <dd>{summary.propKeys.length ? summary.propKeys.join(", ") : "none"}</dd>
        <dt>Events</dt>
        <dd>{summary.eventNames.length ? summary.eventNames.join(", ") : "none"}</dd>
        <dt>Children</dt>
        <dd>{summary.childCount}</dd>
      </dl>
    </section>
  );
}

export function ModelWorkbench({
  inspection,
  selectedState,
  onSelectState,
}: {
  inspection: Inspection | null;
  selectedState?: string | null;
  onSelectState?: (state: string) => void;
}) {
  const withWorkflow = inspection?.entities.find((entity) =>
    entity.operations.some((operation) => operation.kind === "transition"),
  );
  return (
    <div className="workbench-views">
      {withWorkflow ? (
        <section className="catalog-panel" aria-label="Workflow canvas">
          <div className="inspector-heading">
            <div>
              <p className="eyebrow">workflow</p>
              <h2>{withWorkflow.name}</h2>
            </div>
            {selectedState ? <span className="snapshot-id">{selectedState}</span> : null}
          </div>
          <Suspense fallback={<p className="muted" role="status">Loading the canvas...</p>}>
            <WorkflowCanvasHost entity={withWorkflow} onSelectState={onSelectState} />
          </Suspense>
        </section>
      ) : null}
      <section className="catalog-panel" aria-label="Model entities">
        <div className="inspector-heading">
          <div>
            <p className="eyebrow">model</p>
            <h2>Entities</h2>
          </div>
          <span className="snapshot-id">{inspection?.entities.length ?? 0}</span>
        </div>
        <ul className="catalog-list">
          {inspection?.entities.map((entity) => (
            <li key={entity.name}>
              <strong>{entity.name}</strong>
              <span>{entity.fields.length} fields</span>
              <span>{entity.operations.length} operations</span>
            </li>
          ))}
          {inspection && inspection.entities.length === 0 ? <li className="muted">This model declares no entity.</li> : null}
        </ul>
      </section>
      <ComponentCatalog />
    </div>
  );
}

export function JourneyWorkbench({
  inspection,
  selectedStep,
  onSelectStep,
  onConnect,
  onRemove,
}: {
  inspection: Inspection | null;
  selectedStep?: string | null;
  onSelectStep?: (step: string) => void;
  onConnect?: (journey: JourneyInfo, from: string, to: string) => void;
  onRemove?: (journey: JourneyInfo, kind: "step" | "link", id: string) => void;
}) {
  const journeys = inspection?.journeys ?? [];
  return (
    <div className="workbench-views">
      {journeys.map((journey) => (
        <section className="catalog-panel" aria-label={`${journey.name} journey`} key={journey.id}>
          <div className="inspector-heading">
            <div>
              <p className="eyebrow">journey</p>
              <h2>{journey.name}</h2>
            </div>
            <span className="snapshot-id">{journey.source}</span>
          </div>
          <p className="muted">
            A journey is an index over existing pages, operations, and actions. It owns no behavior,
            so there is nothing here to execute.
          </p>
          {journey.diagnostics.length ? (
            <ul className="catalog-list" role="list" aria-label="Journey problems">
              {journey.diagnostics.map((item, index) => (
                <li key={`${item.code}-${index}`}>
                  <strong>{item.code}</strong>
                  <span>{item.message}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <Suspense fallback={<p className="muted" role="status">Loading the canvas...</p>}>
            <JourneyCanvasHost
              journey={journey}
              onSelectStep={onSelectStep}
              onConnect={(from, to) => onConnect?.(journey, from, to)}
              onRemove={(kind, id) => onRemove?.(journey, kind, id)}
            />
          </Suspense>
        </section>
      ))}
      {journeys.length === 0 ? (
        <section className="catalog-panel" aria-label="Journeys">
          <div className="inspector-heading">
            <div>
              <p className="eyebrow">journey</p>
              <h2>Journeys</h2>
            </div>
          </div>
          <p className="muted" role="status">
            No journey is loaded yet. A journey is a <code>*.journey.json</code> file in the project,
            and the console reads it, checks it against the pages and operations that exist, and
            draws it.
          </p>
        </section>
      ) : null}
    </div>
  );
}

export function WorkbenchModeBar({ mode, onChange }: { mode: WorkbenchMode; onChange: (mode: WorkbenchMode) => void }) {
  return (
    <div className="output-tabs" role="tablist" aria-label="Design mode">
      {WORKBENCH_MODES.map((definition) => (
        <button
          key={definition.id}
          id={`mode-${definition.id}`}
          role="tab"
          aria-selected={mode === definition.id}
          aria-controls="workbench-content"
          title={definition.description}
          onClick={() => onChange(definition.id)}
        >
          {definition.label}
        </button>
      ))}
    </div>
  );
}
