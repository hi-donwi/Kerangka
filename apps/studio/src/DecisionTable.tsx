import type { EntityInfo } from "../../../packages/studio-server/src/contracts.js";

export function DecisionTable({ entity }: { entity: EntityInfo }) {
  return (
    <section className="decision-table" aria-label="Decision table">
      <h3>Decision table</h3>
      <p className="muted">
        Existing hit policies and typed cells remain authoritative. This panel displays
        them; editing is not enabled in this slice.
      </p>
      {entity.operations.length === 0 ? (
        <p className="muted">No decision operations.</p>
      ) : (
        <ul>
          {entity.operations.map((operation) => (
            <li key={operation.name}>
              <code>{operation.name}</code>: {operation.kind}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
