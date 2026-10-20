import type { StudioResponse } from "../../../packages/studio-server/src/contracts.js";

export function RouteInspector({ response }: { response: StudioResponse }) {
  return (
    <section className="route-inspector" aria-label="Route manifest">
      <h3>Routes</h3>
      <p className="muted">Declared routes resolve to screens. Duplicate or reserved paths are omitted.</p>
      {response.bundle.application.routes.length === 0 ? (
        <p className="muted">No routes declared.</p>
      ) : (
        <div className="table-scroll" role="region" aria-label="Routes" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>Path</th>
                <th>Page</th>
                <th>Access</th>
              </tr>
            </thead>
            <tbody>
              {response.bundle.application.routes.map((route) => (
                <tr key={route.id}>
                  <td>
                    <code>{route.path}</code>
                  </td>
                  <td>{route.page}</td>
                  <td>{route.access}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
