import { useMemo, useState } from "react";
import { defaultRegistry } from "uidl-runtime";
import type { ScreenInfo } from "../../../packages/studio-server/src/contracts.js";

/**
 * The page designer.
 *
 * The page is the author's UIDL document, so the designer edits that document and
 * nothing else. The tree is the document's own tree, the catalog is the runtime's own
 * registry, and an insertion is a change to the document that the host checks before
 * it is written.
 */

interface TreeNode {
  id: string;
  type: string;
  children: TreeNode[];
}

function treeOf(node: unknown): TreeNode[] {
  if (!node || typeof node !== "object") return [];
  const value = node as {
    id?: string;
    type?: string;
    children?: unknown[];
    slots?: Record<string, unknown[]>;
  };
  const children: TreeNode[] = [];
  for (const child of value.children ?? []) {
    const built = treeOf(child);
    if (built[0]) children.push(built[0]);
  }
  for (const slot of Object.values(value.slots ?? {})) {
    for (const child of slot) {
      const built = treeOf(child);
      if (built[0]) children.push(built[0]);
    }
  }
  return [{ id: value.id ?? "node", type: value.type ?? "Node", children }];
}

export interface PageDesignerProps {
  screen: ScreenInfo;
  selectedNode: string | null;
  onSelectNode: (nodeId: string) => void;
  /** Add a component under the selected node. */
  onAdd: (type: string, parent: string) => void;
  busy?: boolean;
  error?: string | null;
}

export function PageDesigner({ screen, selectedNode, onSelectNode, onAdd, busy, error }: PageDesignerProps) {
  const [query, setQuery] = useState("");
  const tree = useMemo(() => treeOf((screen.document as { root?: unknown })?.root)[0], [screen.document]);
  const widgets = useMemo(() => defaultRegistry.list().filter((widget) => !widget.hideFromPalette), []);
  const matching = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle ? widgets.filter((widget) => widget.type.toLowerCase().includes(needle)) : widgets;
    return list.slice(0, 24);
  }, [query, widgets]);

  const parent = selectedNode ?? tree?.id ?? "";

  return (
    <div className="workbench-views">
      <section className="catalog-panel" aria-label="Page tree">
        <div className="inspector-heading">
          <div>
            <p className="eyebrow">page</p>
            <h2>{screen.label}</h2>
          </div>
          <span className="snapshot-id">{screen.kind}</span>
        </div>
        <p className="muted">The tree is the page's own document. A node is added under the one that is selected.</p>
        <ul className="page-tree">
          {tree ? <TreeRow node={tree} selected={selectedNode} onSelect={onSelectNode} depth={0} /> : null}
        </ul>
        {error ? <p className="error-banner" role="alert">{error}</p> : null}
      </section>
      <section className="catalog-panel" aria-label="Page component catalog">
        <div className="inspector-heading">
          <div>
            <p className="eyebrow">catalog</p>
            <h2>Add a component</h2>
          </div>
          <span className="snapshot-id">under {parent || "the root"}</span>
        </div>
        <label className="field">
          <span>Search</span>
          <input type="search" value={query} placeholder="Button, TextField, layout" onChange={(event) => setQuery(event.target.value)} />
        </label>
        <ul className="catalog-list">
          {matching.map((widget) => (
            <li key={widget.type}>
              <button
                type="button"
                disabled={busy || !parent}
                onClick={() => onAdd(widget.type, parent)}
                aria-label={`Add ${widget.type}`}
              >
                {widget.type}
              </button>
              <span>{widget.category}</span>
            </li>
          ))}
          {matching.length === 0 ? <li className="muted">No component matches that search.</li> : null}
        </ul>
      </section>
    </div>
  );
}

function TreeRow({
  node,
  selected,
  onSelect,
  depth,
}: {
  node: TreeNode;
  selected: string | null;
  onSelect: (nodeId: string) => void;
  depth: number;
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected === node.id}
        style={{ paddingInlineStart: `${depth * 0.75}rem` }}
        onClick={() => onSelect(node.id)}
      >
        {node.type}
        <span className="muted"> {node.id}</span>
      </button>
      {node.children.length ? (
        <ul>
          {node.children.map((child) => (
            <TreeRow key={child.id} node={child} selected={selected} onSelect={onSelect} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
