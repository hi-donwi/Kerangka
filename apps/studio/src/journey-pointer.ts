import type { ScreenInfo } from "../../../packages/studio-server/src/contracts.js";

/**
 * The pointer to the first action a page offers.
 *
 * A journey link says where a connection is realized. When a person draws a link
 * between two steps on the canvas, the link needs that pointer, and the page the
 * connection starts from is the one that has the action. The pointer is found in the
 * page's own document, so it names something that really exists.
 */

interface Found {
  path: string;
}

/** Walk the document tree and return the pointer to the first event action. */
export function firstActionPointer(document: unknown): string | null {
  const root = (document as { root?: unknown } | null)?.root;
  if (!root || typeof root !== "object") return null;
  const found = search(root, "/root");
  return found?.path ?? null;
}

function search(node: unknown, path: string): Found | null {
  if (!node || typeof node !== "object") return null;
  const value = node as {
    id?: string;
    children?: unknown[];
    slots?: Record<string, unknown[]>;
    events?: Record<string, unknown[]>;
  };
  const events = value.events;
  if (events && typeof events === "object") {
    for (const [name, actions] of Object.entries(events)) {
      if (Array.isArray(actions) && actions.length) return { path: `${path}/events/${name}/0` };
    }
  }
  for (const [index, child] of (value.children ?? []).entries()) {
    const found = search(child, `${path}/children/${index}`);
    if (found) return found;
  }
  for (const [slot, children] of Object.entries(value.slots ?? {})) {
    for (const [index, child] of (children ?? []).entries()) {
      const found = search(child, `${path}/slots/${slot}/${index}`);
      if (found) return found;
    }
  }
  return null;
}

/** The page a journey step names, among the screens the project has. */
export function findPage(screens: readonly ScreenInfo[], page: string): ScreenInfo | undefined {
  return screens.find(
    (screen) =>
      screen.id === page ||
      screen.label === page ||
      screen.source?.replace(/\.uidl\.json$/, "") === page,
  );
}
