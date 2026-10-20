import type { EntityInfo } from "../../../packages/studio-server/src/contracts.js";

function cells(value: unknown): Array<[string, string]> {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").map((role) => [role, "always"]);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).map(([role, condition]) => [
    role,
    typeof condition === "boolean" ? (condition ? "always" : "never") : String(condition ?? ""),
  ]);
}

export function AccessMatrix({
  entity,
  roles,
  onOpenSource,
}: {
  entity: EntityInfo;
  roles: string[];
  onOpenSource: () => void;
}) {
  const operations = Object.entries(entity.permissions ?? {});
  return (
    <section className="access-matrix" aria-label="Access matrix">
      <div className="section-heading">
        <h3>Access matrix</h3>
        <button onClick={onOpenSource}>Inspect source</button>
      </div>
      <p className="muted">
        App roles: {roles.join(", ") || "none declared"}. Designer permissions are separate from this matrix.
      </p>
      {operations.length === 0 ? (
        <p className="muted">No permissions declared. All operations default to denied.</p>
      ) : (
        <div className="table-scroll" role="region" aria-label="Operation access" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>Operation</th>
                <th>Role</th>
                <th>Condition</th>
              </tr>
            </thead>
            <tbody>
              {operations.flatMap(([operation, value]) =>
                cells(value).map(([role, condition]) => (
                  <tr key={`${operation}:${role}`}>
                    <th scope="row">{operation}</th>
                    <td>{role}</td>
                    <td>{condition}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
