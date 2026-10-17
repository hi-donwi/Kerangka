import { createRoot } from "react-dom/client";
import { useState } from "react";
import { UIDocumentRenderer, createDocumentState, type DocumentStateStore, type UIDLDocument } from "uidl-runtime";
import { preparePreview, readOnlyAdapter } from "./preview-policy";
import "uidl-runtime/style.css";
import "./preview.css";

const element = document.getElementById("root")!;
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
  if (data.type !== "studio.preview.render" || data.channel !== channel || typeof data.revision !== "string") return;
  if (new TextEncoder().encode(JSON.stringify(data)).length > 2 * 1024 * 1024) {
    notify("studio.preview.error");
    return;
  }
  try {
    const document = preparePreview(data.screen as Parameters<typeof preparePreview>[0]);
    const seed = data.synthetic as Record<string, Array<Record<string, unknown>>>;
    root.render(<ReadOnlyDocument key={data.revision} document={document} seed={seed} />);
  } catch {
    element.textContent = "This document is outside the static read-only preview profile.";
    notify("studio.preview.error");
  }
});
let lastHeight = 0;
new ResizeObserver(() => {
  const height = Math.max(100, Math.min(10000, Math.ceil(element.scrollHeight)));
  if (height !== lastHeight) {
    lastHeight = height;
    notify("studio.preview.height", { height });
  }
}).observe(element);
notify("studio.preview.ready");
