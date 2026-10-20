import type { EntityInfo } from "../../../packages/studio-server/src/contracts.js";

export function ConnectorInspector({ entity }: { entity: EntityInfo }) {
  return (
    <section className="connector-inspector" aria-label="Connector references">
      <h3>Connector references</h3>
      <p className="muted">
        Source contains only secret references and declared connector configuration.
        Simulation uses a stub. No credential is shown here.
      </p>
      {entity.operations.length === 0 ? (
        <p className="muted">No connector operations.</p>
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
