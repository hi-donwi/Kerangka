import { useState } from "react";

export function MaterializePage({
  view,
  sourceText,
  document,
  onMaterialize,
}: {
  view: string;
  sourceText: string;
  /** The generated document, so the authored page starts as the real page. */
  document?: unknown;
  onMaterialize: (path: string, text: string) => void;
}) {
  const [status, setStatus] = useState<string | null>(null);
  return (
    <section className="materialize-panel" aria-label="Materialize recipe page">
      <h3>Materialize recipe page</h3>
      <p className="muted">
        Convert the selected recipe view into an authored UIDL source. The authored page starts
        as the generated page, with its properties, bindings, and actions, and regeneration
        leaves authored files untouched.
      </p>
      <button
        type="button"
        onClick={() => {
          if (!document) {
            setStatus("This view has no generated document to copy.");
            return;
          }
          const authored = {
            ...(document as Record<string, unknown>),
            $schema: "https://uidl.dev/schema/v1/document.schema.json",
            id: view,
            name: view,
          };
          onMaterialize(`${view}.uidl.json`, JSON.stringify(authored, null, 2));
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
