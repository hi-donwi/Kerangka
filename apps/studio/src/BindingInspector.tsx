import type { EntityInfo } from "../../../packages/studio-server/src/contracts.js";

export function BindingInspector({ entity }: { entity: EntityInfo }) {
  return (
    <section className="binding-inspector" aria-label="Component bindings">
      <h3>Bindings</h3>
      <p className="muted">
        Bindings are declared in the source bundle. This panel lists the operations a component
        may call; it does not grant runtime permission.
      </p>
      <ul>
        {entity.operations.map((operation) => (
          <li key={operation.name}>
            <code>{operation.name}</code>: {operation.kind}
            {operation.guarded ? " (guarded)" : ""}
          </li>
        ))}
      </ul>
      {entity.operations.length === 0 ? <p className="muted">No operations to bind.</p> : null}
    </section>
  );
}
