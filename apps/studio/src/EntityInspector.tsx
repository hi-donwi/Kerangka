import type { EntityInfo } from "../../../packages/studio-server/src/contracts.js";

export function EntityInspector({
  entity,
  roles,
  onOpenSource,
}: {
  entity: EntityInfo;
  roles: string[];
  onOpenSource: () => void;
}) {
  return (
    <div className="entity-inspector">
      <div className="section-heading">
        <h3>Field contract</h3>
        <button onClick={onOpenSource}>Inspect source</button>
      </div>
      <div className="table-scroll" role="region" aria-label="Entity fields" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>Field</th>
              <th>Type</th>
              <th>Required</th>
              <th>Computed</th>
            </tr>
          </thead>
          <tbody>
            {entity.fields.map((field) => (
              <tr key={field.name}>
                <th scope="row">{field.name}</th>
                <td>
                  <code>{field.type}</code>
                </td>
                <td>{field.required ? "Yes" : "No"}</td>
                <td>{field.computed ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Operations</h3>
      {entity.operations.length ? (
        <ul className="operation-list">
          {entity.operations.map((operation) => (
            <li key={`${operation.kind}:${operation.name}`}>
              <strong>{operation.name}</strong>
              <span>
                {operation.kind}
                {operation.to ? ` / ${operation.from?.join(", ")} to ${operation.to}` : ""}
              </span>
              <small>
                {operation.roles.join(", ") || "No operation roles declared"}
                {operation.guarded ? " / Guarded" : ""}
              </small>
            </li>
          ))}
        </ul>
      ) : (
        <p>No actions or transitions.</p>
      )}
      <p className="muted">Business roles: {roles.join(", ") || "none declared"}. These do not grant Studio access.</p>
    </div>
  );
}
