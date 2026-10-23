import { useEffect, useRef, useState } from "react";
import type { ScreenInfo } from "../../../packages/studio-server/src/contracts.js";
import { studioBase } from "./studio-api";
import { previewPayload } from "./preview-policy";
import { previewHighlightMessage, readPreviewSelection } from "./preview-selection";

export function PreviewFrame({
  screen,
  revision,
  synthetic,
  onSelectNode,
}: {
  screen: ScreenInfo;
  revision: string;
  synthetic: Record<string, Array<Record<string, unknown>>>;
  /** Called when a person selects a node in the preview. */
  onSelectNode?: (nodeId: string) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [channel] = useState(() => crypto.randomUUID());
  const [height, setHeight] = useState(600);
  const [error, setError] = useState<string | null>(null);
  /** The node selected in the preview. The console marks it so the author sees it. */
  const [selected, setSelected] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  let admission: string | null = null;
  let payload: ReturnType<typeof previewPayload> | null = null;
  try {
    payload = previewPayload(screen, revision, synthetic, channel);
  } catch (reason) {
    admission = reason instanceof Error ? reason.message : "Preview admission failed.";
  }
  const send = () => {
    if (payload) frame.current?.contentWindow?.postMessage(payload, "*");
  };
  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== "null" ||
        typeof event.data !== "object" ||
        event.data === null
      )
        return;
      const data = event.data as Record<string, unknown>;
      if (data.channel !== channel) return;
      if (data.type === "studio.preview.ready") send();
      if (data.type === "studio.preview.select") {
        const nodeId = readPreviewSelection(data, channel, revision);
        if (nodeId) {
          setSelected(nodeId);
          onSelectNode?.(nodeId);
        }
        return;
      }
      if (
        data.type === "studio.preview.height" &&
        typeof data.height === "number" &&
        Number.isInteger(data.height) &&
        data.height >= 100 &&
        data.height <= 10000
      )
        setHeight(data.height);
      if (data.type === "studio.preview.error") setError("The isolated renderer could not render this document.");
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [channel, revision, screen, synthetic, onSelectNode]);

  useEffect(() => {
    if (!selected) return;
    frame.current?.contentWindow?.postMessage(previewHighlightMessage(channel, revision, selected), "*");
  }, [channel, revision, selected]);
  if (admission)
    return (
      <div className="empty-state" role="alert">
        <h3>Preview is source-only.</h3>
        <p>{admission}</p>
        <p>The original document was not modified. Inspect its source instead.</p>
      </div>
    );
  return (
    <div className="preview-panel">
      <div className="preview-heading">
        <div>
          <strong>Synthetic UIDL preview</strong>
          <p data-testid="preview-selection">
            {selected ? `Selected node: ${selected}` : "Select a node in the preview to inspect it."}
          </p>
          <p>
            Static, read-only. Handlers and inline authored data are disabled; no authoring access is sent to this
            frame.
          </p>
        </div>
        <button
          onClick={() => {
            setError(null);
            setReload((value) => value + 1);
          }}
        >
          Reload preview
        </button>
      </div>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      <div className="preview-scroll" role="region" aria-label="Preview scroll area" tabIndex={0}>
        <iframe
          ref={frame}
          key={reload}
          title="Synthetic UIDL preview"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          tabIndex={-1}
          height={height}
          src={`${studioBase()}preview.html#channel=${channel}`}
          onLoad={send}
        />
      </div>
    </div>
  );
}
