import { useState } from "react";

export function EjectPanel({ modelPath }: { modelPath: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const command = `npx kerangka scaffold ${modelPath.replace(/\.kerangka\.json$/, "")} --output ./exported-app`;
  return (
    <section className="eject-panel" aria-label="Export runnable application">
      <h3>Export runnable application</h3>
      <p className="muted">
        Delegates to the Kerangka CLI scaffold contract. The exported project depends only on
        published packages. Run it in a terminal with the CLI installed.
      </p>
      <pre className="source-view">{command}</pre>
      <button type="button" onClick={() => { navigator.clipboard?.writeText(command); setStatus("Command copied."); }}>
        Copy command
      </button>
      {status ? <p role="status">{status}</p> : null}
    </section>
  );
}
