import type { EntityInfo } from "../../../packages/studio-server/src/contracts.js";

export function EventPolicy({ entity }: { entity: EntityInfo }) {
  return (
    <section className="event-policy" aria-label="Event policy">
      <h3>Event policy</h3>
      <p className="muted">
        Event and schedule links use existing semantics. Effects are displayed, not
        performed.
      </p>
      {entity.operations.length === 0 ? (
        <p className="muted">No event-driven operations.</p>
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
