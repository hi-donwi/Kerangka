/**
 * Row decoration for list documents.
 *
 * A generated list document opens a row with
 * `navigate { route: { $bind: "event.route" } }` — the DataTable hands the clicked row to the
 * action, and `event.route` reads that row's own `route`. The model row has no such field, so the
 * host decorates each row with the route it should open before the data reaches the table. That
 * keeps the document pure (it names no entity key and builds no URL) and keeps routing a host
 * concern.
 *
 * License: Apache-2.0
 */

/**
 * Adds a `route` field to every row, filling `:param` placeholders from the row's own fields.
 *
 * `decorateRowRoutes(rows, "/invoice/:id")` turns `{ id: "INV-1" }` into
 * `{ id: "INV-1", route: "/invoice/INV-1" }`.
 */
export function decorateRowRoutes<T extends Record<string, unknown>>(
  rows: T[],
  routeTemplate: string,
): Array<T & { route: string }> {
  return rows.map((row) => ({ ...row, route: fillTemplate(routeTemplate, row) }));
}

function fillTemplate(template: string, row: Record<string, unknown>): string {
  return template.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_match, param: string) => {
    const value = row[param];
    return value === undefined || value === null ? "" : encodeURIComponent(String(value));
  });
}
