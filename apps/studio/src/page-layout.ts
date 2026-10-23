import { defaultRegistry, type UIDLDocument, type UIDLNode } from "uidl-runtime";

export interface PageMove { parent: string; index: number; slot?: string }
export type DropPlacement = "before" | "after" | "inside";

export function pageMoveTarget(document: UIDLDocument, source: string, target: string, placement: DropPlacement): PageMove | null {
  interface Location { node: UIDLNode; parent?: UIDLNode; slot?: string; index: number }
  function locate(node: UIDLNode, id: string, parent?: UIDLNode, slot?: string, index = 0): Location | undefined {
    if (node.id === id) return { node, parent, slot, index };
    for (const [at, child] of (node.children ?? []).entries()) {
      const found = locate(child, id, node, undefined, at);
      if (found) return found;
    }
    for (const [name, children] of Object.entries(node.slots ?? {})) {
      for (const [at, child] of children.entries()) {
        const found = locate(child, id, node, name, at);
        if (found) return found;
      }
    }
    return undefined;
  }
  const from = locate(document.root, source);
  const to = locate(document.root, target);
  if (!from?.parent || !to || from.node.id === to.node.id) return null;
  const parent = placement === "inside" ? to.node : to.parent;
  const slot = placement === "inside" ? undefined : to.slot;
  if (!parent || locate(from.node, parent.id)) return null;
  const manifest = defaultRegistry.get(parent.type);
  if (!manifest || (!slot && !manifest.acceptsChildren)) return null;
  const children = slot ? parent.slots?.[slot] ?? [] : parent.children ?? [];
  const sameArray = from.parent.id === parent.id && from.slot === slot;
  let index = placement === "inside" ? children.length : to.index + (placement === "after" ? 1 : 0);
  if (sameArray && from.index < index) index--;
  if (sameArray && from.index === index) return null;
  return { parent: parent.id, index, ...(slot ? { slot } : {}) };
}
