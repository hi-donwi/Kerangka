import { useState } from "react";
import { defaultRegistry, type UIDLDocument } from "uidl-runtime";
import type { ScreenInfo } from "../../../packages/studio-server/src/contracts.js";
import { findDocumentNode } from "./workbench-modes";
import { PageNodeInspector } from "./PageNodeInspector";
import { PageTree } from "./PageTree";

export interface PageDesignerProps {
  screen: ScreenInfo;
  selectedNode: string | null;
  onSelectNode: (nodeId: string) => void;
  onAdd: (type: string, parent: string) => void;
  onSetProp: (nodeId: string, key: string, value: unknown) => void;
  onMove: (nodeId: string, parent: string, index: number, slot?: string) => void;
  onCopy: (nodeId: string, parent: string) => void;
  onSetStyle: (nodeId: string, field: string, value: unknown, breakpoint?: string) => void;
  onSetTheme: (theme: string) => void;
  onSetThemeRef: (nodeId: string, reference: string) => void;
  definitions: Array<{ name: string; type: string }>;
  busy?: boolean;
  error?: string | null;
}

export function PageDesigner({
  screen, selectedNode, onSelectNode, onAdd, onSetProp, onMove, onCopy,
  onSetStyle, onSetTheme, onSetThemeRef, definitions, busy, error,
}: PageDesignerProps) {
  const [query, setQuery] = useState("");
  const document = screen.document as UIDLDocument;
  const selected = findDocumentNode(document, selectedNode ?? document.root?.id ?? "");
  const widgets = defaultRegistry.list().filter((widget) => !widget.hideFromPalette);
  const matching = widgets.filter((widget) => widget.type.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 24);
  const readOnly = screen.kind !== "authored";
  const parent = selected?.id ?? document.root?.id ?? "";
  const canInsert = Boolean(selected && defaultRegistry.get(selected.type)?.acceptsChildren);
  return (
    <div className="workbench-views">
      <section className="catalog-panel" aria-label="Page tree">
        <div className="inspector-heading">
          <div><p className="eyebrow">page</p><h2>{screen.label}</h2></div>
          <span className="snapshot-id">{screen.kind}</span>
        </div>
        {readOnly ? <p className="muted" role="status">Generated page: materialize it before making visual edits.</p> : null}
        {document.root ? <PageTree {...{ document, onMove }} selected={selectedNode} onSelect={onSelectNode} disabled={readOnly || Boolean(busy)} /> : null}
        {error ? <p className="error-banner" role="alert">{error}</p> : null}
        {selected ? (
          <>
            <PageNodeInspector {...{ document, busy, readOnly, onSetProp, onSetTheme, onSetThemeRef }} node={selected} />
            <NodeStyle key={selected.id} node={selected.id} disabled={readOnly || Boolean(busy)} {...{ onSetStyle, onCopy }} />
          </>
        ) : <p className="muted">Select a layer to inspect its runtime properties.</p>}
        {definitions.length ? <section aria-label="Reusable definitions"><h3>Definitions</h3><ul className="catalog-list">
          {definitions.map((definition) => <li key={definition.name}><strong>{definition.name}</strong><span>{definition.type}</span></li>)}
        </ul></section> : null}
      </section>
      <section className="catalog-panel" aria-label="Page component catalog">
        <div className="inspector-heading"><div><p className="eyebrow">catalog</p><h2>Add a component</h2></div><span className="snapshot-id">under {parent || "the root"}</span></div>
        <label className="field"><span>Search</span><input type="search" value={query} placeholder="Button, TextField, layout" onChange={(event) => setQuery(event.target.value)} /></label>
        {!canInsert ? <p className="muted">Select a container layer before inserting a component.</p> : null}
        <ul className="catalog-list">
          {matching.map((widget) => <li key={widget.type}><button type="button" disabled={readOnly || busy || !canInsert} onClick={() => onAdd(widget.type, parent)} aria-label={`Add ${widget.type}`}>{widget.type}</button><span>{widget.category}</span></li>)}
          {!matching.length ? <li className="muted">No component matches that search.</li> : null}
        </ul>
      </section>
    </div>
  );
}

function NodeStyle({ node, disabled, onSetStyle, onCopy }: {
  node: string; disabled: boolean;
  onSetStyle: PageDesignerProps["onSetStyle"]; onCopy: PageDesignerProps["onCopy"];
}) {
  const [field, setField] = useState("");
  const [value, setValue] = useState("");
  const [breakpoint, setBreakpoint] = useState("");
  return (
    <form className="draft-form node-style-editor" aria-label="Node style" onSubmit={(event) => {
      event.preventDefault();
      let parsed: unknown = value;
      try { parsed = JSON.parse(value); } catch { /* Utility-class intent values remain strings. */ }
      onSetStyle(node, field.trim(), parsed, breakpoint || undefined);
    }}>
      <h3>Style of {node}</h3>
      <p className="muted">Use runtime utility values such as gap-4 and p-4, not raw CSS lengths.</p>
      <label htmlFor="style-field">Field</label>
      <input id="style-field" value={field} disabled={disabled} placeholder="gap, display, padding" onChange={(event) => setField(event.target.value)} />
      <label htmlFor="style-value">Style Value</label>
      <input id="style-value" value={value} disabled={disabled} placeholder="gap-4" onChange={(event) => setValue(event.target.value)} />
      <label htmlFor="style-breakpoint">Breakpoint (optional)</label>
      <select id="style-breakpoint" value={breakpoint} disabled={disabled} onChange={(event) => setBreakpoint(event.target.value)}>
        <option value="">Base Style</option>
        {["base", "sm", "md", "lg", "xl", "2xl"].map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
      <button type="submit" disabled={disabled || !field.trim()}>Set style</button>
      <button type="button" disabled={disabled} onClick={() => onCopy(node, node)}>Copy this node</button>
    </form>
  );
}
