import type { UIDLDocument, UIDLNode } from "uidl-runtime";

/**
 * The three ways a person works on an application.
 *
 * They are not three editors and they do not own different data. They are three views
 * over the same source: the pages, the journey between them, and the model underneath.
 * The mode is a routing hint for the console, and it never changes what the source says.
 */

export type WorkbenchMode = "page" | "journey" | "model";

export interface WorkbenchModeDefinition {
  id: WorkbenchMode;
  label: string;
  description: string;
}

export const WORKBENCH_MODES: readonly WorkbenchModeDefinition[] = [
  {
    id: "page",
    label: "Pages",
    description: "The screens a person sees, and the actions they trigger.",
  },
  {
    id: "journey",
    label: "Journeys",
    description: "How a person moves between screens, and what the model does for them.",
  },
  {
    id: "model",
    label: "Model",
    description: "The entities, fields, and operations the application is built on.",
  },
];

/** Find a node anywhere in a document's tree, including its slots. */
export function findNode(node: UIDLNode | undefined, id: string): UIDLNode | null {
  if (!node) return null;
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  for (const slot of Object.values(node.slots ?? {})) {
    for (const child of slot) {
      const found = findNode(child, id);
      if (found) return found;
    }
  }
  return null;
}

/** Find a node in a document by its id. */
export function findDocumentNode(document: unknown, id: string): UIDLNode | null {
  if (typeof document !== "object" || document === null) return null;
  const root = (document as UIDLDocument).root;
  return findNode(root, id);
}

export interface NodeSummary {
  id: string;
  type: string;
  propKeys: string[];
  eventNames: string[];
  childCount: number;
}

/** The facts an inspector shows about one node, without inventing any of them. */
export function nodeSummary(node: UIDLNode): NodeSummary {
  return {
    id: node.id,
    type: node.type,
    propKeys: Object.keys(node.props ?? {}).sort(),
    eventNames: Object.keys(node.events ?? {}).sort(),
    childCount: (node.children ?? []).length + Object.values(node.slots ?? {}).reduce((total, slot) => total + slot.length, 0),
  };
}
