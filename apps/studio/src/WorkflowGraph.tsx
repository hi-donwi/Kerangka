import type { EntityInfo } from "../../../packages/studio-server/src/contracts.js";

export function WorkflowGraph({
  entity,
}: {
  entity: EntityInfo;
}) {
  const transitions = entity.operations.filter((item) => item.kind === "transition");
  const states = Array.from(new Set(transitions.flatMap((item) => [...(item.from ?? []), item.to ?? ""]).filter(Boolean)));
  const terminal = states.filter((state) => transitions.every((item) => !item.from?.includes(state)));
  return (
    <section className="workflow-graph" aria-label="Workflow state graph">
      <h3>Workflow states</h3>
      <table>
        <thead>
          <tr>
            <th>State</th>
            <th>Transitions</th>
            <th>Roles</th>
          </tr>
        </thead>
        <tbody>
          {states.map((state) => (
            <tr key={state}>
              <th scope="row">{state}</th>
              <td>
                {transitions
                  .filter((item) => item.from?.includes(state))
                  .map((item) => `${item.name} -> ${item.to}`)
                  .join(", ") || "terminal"}
              </td>
              <td>
                {transitions
                  .filter((item) => item.from?.includes(state))
                  .flatMap((item) => item.roles)
                  .join(", ") || "none"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">
        This graph is a projection of the compiled workflow. It does not add or remove transitions.
        {terminal.length ? ` Terminal states: ${terminal.join(", ")}.` : ""}
      </p>
    </section>
  );
}
