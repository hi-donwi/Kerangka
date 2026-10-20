import type { StudioResponse } from "../../../packages/studio-server/src/contracts.js";

export function SchemaImpact({ response }: { response: StudioResponse }) {
  const postgres = response.inspection?.outputs.postgres ?? "";
  const sqlite = response.inspection?.outputs.sqlite ?? "";
  return (
    <section className="schema-impact" aria-label="Schema impact">
      <h3>Schema impact</h3>
      <p className="muted">DDL is derived from the model. No independent SQL edit is applied.</p>
      <details>
        <summary>PostgreSQL</summary>
        <pre className="source-view">{postgres.slice(0, 1200)}</pre>
      </details>
      <details>
        <summary>SQLite</summary>
        <pre className="source-view">{sqlite.slice(0, 1200)}</pre>
      </details>
    </section>
  );
}
