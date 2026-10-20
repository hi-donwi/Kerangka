import { useState } from "react";

export function MaterializePage({
  view,
  sourceText,
  onMaterialize,
}: {
  view: string;
  sourceText: string;
  onMaterialize: (path: string, text: string) => void;
}) {
  const [status, setStatus] = useState<string | null>(null);
  return (
    <section className="materialize-panel" aria-label="Materialize recipe page">
      <h3>Materialize recipe page</h3>
      <p className="muted">
        Convert the selected recipe view into an authored UIDL source. Regeneration leaves
        authored files untouched.
      </p>
      <button
        type="button"
        onClick={() => {
          onMaterialize(`${view}.uidl.json`, JSON.stringify({ $schema: "https://uidl.dev/schema/v1/document.schema.json", version: "1.0.0", id: view, name: view, root: { id: "root", type: "Container", children: [] } }, null, 2));
          setStatus(`${view}.uidl.json created as authored source.`);
        }}
      >
        Materialize {view}
      </button>
      {status ? <p role="status">{status}</p> : null}
      <pre className="source-view">{sourceText.slice(0, 120)}</pre>
    </section>
  );
}
