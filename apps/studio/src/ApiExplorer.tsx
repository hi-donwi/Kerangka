import type { StudioResponse } from "../../../packages/studio-server/src/contracts.js";

export function ApiExplorer({ response }: { response: StudioResponse }) {
  const openapi = response.inspection?.outputs.openapi ?? "";
  return (
    <section className="api-explorer" aria-label="API explorer">
      <h3>API explorer</h3>
      <p className="muted">
        The emitted OpenAPI contract is shown here. Live sandbox requests are not enabled in
        this slice.
      </p>
      <pre className="source-view">{openapi.slice(0, 1200)}</pre>
    </section>
  );
}
