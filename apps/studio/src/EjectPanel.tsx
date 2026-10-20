import { useState } from "react";

export function EjectPanel({ modelPath }: { modelPath: string }) {
  const [status, setStatus] = useState<string | null>(null);
  return (
    <section className="eject-panel" aria-label="Export runnable application">
      <h3>Export runnable application</h3>
      <p className="muted">
        Delegates to the Kerangka CLI eject contract. The exported project depends only on
        published packages and the supplied connector packages.
      </p>
      <pre className="source-view">
        npx kerangka eject {modelPath} --out ./exported-app
      </pre>
      <button type="button" onClick={() => setStatus("Run the command above in a terminal with the CLI installed.")}>
        Copy command
      </button>
      {status ? <p role="status">{status}</p> : null}
    </section>
  );
}
