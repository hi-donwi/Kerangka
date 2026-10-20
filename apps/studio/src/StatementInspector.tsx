import type { EntityInfo } from "../../../packages/studio-server/src/contracts.js";

export function StatementInspector({ entity }: { entity: EntityInfo }) {
  return (
    <section className="statement-inspector" aria-label="Action statements">
      <h3>Action statements</h3>
      <p className="muted">
        Supported statements are shown in source order. Unsupported statements stay
        source-only.
      </p>
      {entity.operations.length === 0 ? (
        <p className="muted">No actions or transitions.</p>
      ) : (
        <ul>
          {entity.operations.map((operation) => (
            <li key={operation.name}>
              <code>{operation.name}</code>: {operation.kind}
              {operation.guarded ? " (guarded)" : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
