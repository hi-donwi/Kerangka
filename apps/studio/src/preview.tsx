import { createRoot } from "react-dom/client";
import { useState } from "react";
import { UIDocumentRenderer, createDocumentState, type DocumentStateStore, type UIDLDocument } from "uidl-runtime";
import { preparePreview, readOnlyAdapter } from "./preview-policy";
import { PREVIEW_HIGHLIGHT, previewSelectionMessage, readPreviewHighlight } from "./preview-selection";
import "uidl-runtime/style.css";
import "./preview.css";

const element = document.getElementById("root")!;
/** The revision the frame is currently showing. A selection belongs to one of them. */
let currentRevision = "";
const channel = new URLSearchParams(location.hash.slice(1)).get("channel");
const parentOrigin = new URL(location.href).origin;
const notify = (type: string, extra: Record<string, unknown> = {}) =>
  window.parent.postMessage({ type, channel, ...extra }, "*");
const root = createRoot(element, {
  onUncaughtError: () => {
    element.textContent = "The read-only renderer could not display this document.";
    notify("studio.preview.error");
  },
});

function ReadOnlyDocument({
  document,
  seed,
}: {
  document: UIDLDocument;
  seed: Record<string, Array<Record<string, unknown>>>;
}) {
  const [stateStore] = useState<DocumentStateStore>(() => {
    const store = createDocumentState(document.state);
    // Preserve the host-store identity while query writes expose the latest state snapshot.
    return {
      get state() {
        return store.getState().state;
      },
      setState: (path, value) => store.getState().setState(path, value),
      getValue: (path) => store.getState().getValue(path),
      resetState: () => store.getState().resetState(),
      subscribe: (listener) => store.getState().subscribe(listener),
    };
  });
  const [adapter] = useState(() => readOnlyAdapter(seed));
  return <UIDocumentRenderer document={document} dataAdapter={adapter} stateStore={stateStore} />;
}
window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (
    !channel ||
    event.source !== window.parent ||
    event.origin !== parentOrigin ||
    typeof event.data !== "object" ||
    event.data === null
  )
    return;
  const data = event.data as Record<string, unknown>;
  if (data.type === PREVIEW_HIGHLIGHT) {
    const selected = readPreviewHighlight(data, channel ?? "", currentRevision);
    if (selected !== undefined) markSelected(selected);
    return;
  }
  if (data.type !== "studio.preview.render" || data.channel !== channel || typeof data.revision !== "string") return;
  if (new TextEncoder().encode(JSON.stringify(data)).length > 2 * 1024 * 1024) {
    notify("studio.preview.error");
    return;
  }
  try {
    currentRevision = data.revision;
    const document = preparePreview(data.screen as Parameters<typeof preparePreview>[0]);
    const seed = data.synthetic as Record<string, Array<Record<string, unknown>>>;
    root.render(<ReadOnlyDocument key={data.revision} document={document} seed={seed} />);
  } catch {
    element.textContent = "This document is outside the static read-only preview profile.";
    notify("studio.preview.error");
  }
});
/**
 * The node a person clicked, reported to the console.
 *
 * A click is a selection gesture, not a behavior: the preview runs no event and
 * changes nothing. The frame names the node, and the console decides what that means.
 */
element.addEventListener(
  "click",
  (event) => {
    const target = event.target as Element | null;
    const node = target?.closest?.("[data-node-id]");
    const nodeId = node?.getAttribute("data-node-id");
    if (!channel || !nodeId || !currentRevision) return;
    window.parent.postMessage(previewSelectionMessage(channel, currentRevision, nodeId), "*");
  },
  true,
);

/** The console marks the node it is inspecting, so the author sees where they are. */
function markSelected(nodeId: string | null): void {
  for (const previous of element.querySelectorAll("[data-studio-selected]")) {
    previous.removeAttribute("data-studio-selected");
  }
  if (!nodeId) return;
  const target = element.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`);
  target?.setAttribute("data-studio-selected", "true");
}

let lastHeight = 0;
new ResizeObserver(() => {
  const height = Math.max(100, Math.min(10000, Math.ceil(element.scrollHeight)));
  if (height !== lastHeight) {
    lastHeight = height;
    notify("studio.preview.height", { height });
  }
}).observe(element);
notify("studio.preview.ready");
