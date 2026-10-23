import { useRef, useState, type PointerEvent } from "react";
import type { UIDLDocument, UIDLNode } from "uidl-runtime";
import { pageMoveTarget, type DropPlacement } from "./page-layout";

interface Props {
  document: UIDLDocument;
  selected: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, parent: string, index: number, slot?: string) => void;
}

export function PageTree({ document, selected, disabled, onSelect, onMove }: Props) {
  const dragged = useRef<string | null>(null);
  const [over, setOver] = useState<{ id: string; placement: DropPlacement; accepted: boolean } | null>(null);
  const [message, setMessage] = useState("");
  function cancel() { dragged.current = null; setOver(null); }
  function target(event: PointerEvent<HTMLDivElement>) {
    if (!dragged.current) return null;
    const row = window.document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-page-node]");
    if (!row || !event.currentTarget.contains(row)) return null;
    const id = row.dataset.pageNode!;
    const box = row.getBoundingClientRect();
    const ratio = (event.clientY - box.top) / box.height;
    const placement: DropPlacement = ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "inside";
    const move = pageMoveTarget(document, dragged.current, id, placement);
    return { id, placement, move };
  }
  return (
    <div
      className="page-tree-surface"
      onPointerDown={(event) => {
        const handle = (event.target as Element).closest<HTMLElement>("[data-drag-node]");
        if (!handle || disabled || event.button !== 0) return;
        event.preventDefault();
        dragged.current = handle.dataset.dragNode!;
        event.currentTarget.setPointerCapture(event.pointerId);
        setMessage(`Moving ${dragged.current}. Choose before, inside, or after a layer. Escape cancels.`);
      }}
      onPointerMove={(event) => {
        if (!dragged.current) return;
        const next = target(event);
        setOver(next ? { id: next.id, placement: next.placement, accepted: Boolean(next.move) } : null);
      }}
      onPointerUp={(event) => {
        const source = dragged.current;
        const next = source && !disabled ? target(event) : null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        cancel();
        if (source && next?.move) {
          setMessage(`Moved ${source} ${next.placement} ${next.id}. The change is in the draft.`);
          onMove(source, next.move.parent, next.move.index, next.move.slot);
        } else if (source) setMessage("Move cancelled. The document is unchanged.");
      }}
      onPointerCancel={cancel}
      onKeyDown={(event) => { if (event.key === "Escape") { cancel(); setMessage("Move cancelled."); } }}
    >
      <p className="muted">Drag a layer handle, or use Up and Down. Slots remain separate from children.</p>
      <ul className="page-tree" aria-label="Page layers">
        <Row node={document.root} root {...{ selected, disabled, onSelect, onMove, over }} />
      </ul>
      <p className="page-move-status" role="status">{message}</p>
    </div>
  );
}

function Row({ node, root, selected, disabled, onSelect, onMove, over, parent, index, count, slot }: {
  node: UIDLNode; root?: boolean; selected: Props["selected"]; disabled: boolean;
  onSelect: Props["onSelect"]; onMove: Props["onMove"];
  over: { id: string; placement: DropPlacement; accepted: boolean } | null;
  parent?: string; index?: number; count?: number; slot?: string;
}) {
  return (
    <li>
      <div className="page-layer-row" data-page-node={node.id}
        data-drop-position={over?.id === node.id ? over.placement : undefined}
        data-drop-allowed={over?.id === node.id ? over.accepted : undefined}>
        {!root ? <button type="button" className="page-drag-handle" data-drag-node={node.id} disabled={disabled}
          aria-label={`Drag ${node.id}`} title="Drag before, inside, or after another layer">Move</button> : null}
        <button type="button" className="page-layer-select" aria-pressed={selected === node.id} onClick={() => onSelect(node.id)}>
          {node.type}<span className="muted"> {node.id}</span>
        </button>
        {parent !== undefined && index !== undefined ? (
          <span className="page-tree-actions">
            <button type="button" disabled={disabled || index === 0} aria-label={`Move ${node.id} up`} onClick={() => onMove(node.id, parent, index - 1, slot)}>Up</button>
            <button type="button" disabled={disabled || index === (count ?? 1) - 1} aria-label={`Move ${node.id} down`} onClick={() => onMove(node.id, parent, index + 1, slot)}>Down</button>
          </span>
        ) : null}
      </div>
      {node.children?.length ? <ul>{node.children.map((child, at) => <Row key={child.id} node={child} parent={node.id} index={at} count={node.children!.length} {...{ selected, disabled, onSelect, onMove, over }} />)}</ul> : null}
      {Object.entries(node.slots ?? {}).map(([name, children]) => (
        <div className="page-slot" key={name}>
          <span className="muted">Slot: {name}</span>
          <ul>{children.map((child, at) => <Row key={child.id} node={child} parent={node.id} slot={name} index={at} count={children.length} {...{ selected, disabled, onSelect, onMove, over }} />)}</ul>
        </div>
      ))}
    </li>
  );
}
