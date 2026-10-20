import type { EntityInfo } from "../../../packages/studio-server/src/contracts.js";

export function ComponentTree({ entity }: { entity: EntityInfo }) {
  return (
    <section className="component-tree" aria-label="Entity component tree">
      <h3>Entity tree</h3>
      <p className="muted">Fields and operations are shown in source order. Moves are not enabled in this slice.</p>
      <ul>
        <li>
          <strong>{entity.name}</strong>
          <ul>
            {entity.fields.map((field) => (
              <li key={field.name}>
                {field.name}: {field.type}
                {field.required ? " (required)" : ""}
                {field.computed ? " (computed)" : ""}
              </li>
            ))}
            {entity.operations.map((operation) => (
              <li key={operation.name}>
                {operation.name}: {operation.kind}
                {operation.guarded ? " (guarded)" : ""}
              </li>
            ))}
          </ul>
        </li>
      </ul>
    </section>
  );
}
