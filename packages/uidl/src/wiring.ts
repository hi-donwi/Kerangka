/**
 * Host wiring helpers: the small, React-free pieces a host needs to seed a document's state and
 * hand the runtime data that matches the document's shape.
 *
 * The runtime itself (`UIDocumentRenderer`) already owns the loop that re-runs a declared
 * `$query` when the state it binds changes, and it seeds nothing on its own. What it cannot know
 * is Kerangka's routing and entity conventions: which URL parameter is the record id, what the
 * blank form looks like, and what each list row should open. Those are the seams here — pure
 * functions plus two thin wrappers over the structural `DataAdapter`/state-store shapes, so they
 * test without React and drop into any host.
 *
 * License: Apache-2.0
 */

import { decorateRowRoutes } from "./routes.js";
import type { DataAdapter, Query } from "./types.js";

/** The subset of UIDL-Runtime's `DocumentStateStore` these helpers use (structural). */
export interface StateStoreLike {
  readonly state: Record<string, unknown>;
  setState(path: string, value: unknown): void;
  getValue?(path?: string): unknown;
  subscribe?(listener: () => void): () => void;
}

function readPath(source: Record<string, unknown>, path: string): unknown {
  let current: unknown = source;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object" || !(key in (current as Record<string, unknown>))) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function getValue(store: StateStoreLike, path: string): unknown {
  return store.getValue ? store.getValue(path) : readPath(store.state, path);
}

/**
 * Matches a document route template (`/invoice/:id`) against a concrete path
 * (`/invoice/INV-1`) and returns its parameters (`{ id: "INV-1" }`). Returns `undefined` when
 * the path does not match. Trailing slashes are ignored.
 */
export function routeParams(routePattern: string, pathname: string): Record<string, string> | undefined {
  const patternSegments = splitPath(routePattern);
  const pathSegments = splitPath(pathname);
  if (patternSegments.length !== pathSegments.length) return undefined;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternSegments.length; i += 1) {
    const pattern = patternSegments[i]!;
    const actual = pathSegments[i]!;
    if (pattern.startsWith(":")) {
      params[pattern.slice(1)] = decodeURIComponent(actual);
    } else if (pattern !== actual) {
      return undefined;
    }
  }
  return params;
}

function splitPath(path: string): string[] {
  return path.split("/").filter(Boolean);
}

/**
 * Seeds `state.params` (where generated documents bind `state.params.id`) from the URL, using the
 * document's route template. No-op when the path does not match the template.
 */
export function seedRouteParams(store: StateStoreLike, routePattern: string, pathname: string): boolean {
  const params = routeParams(routePattern, pathname);
  if (!params) return false;
  store.setState("params", params);
  return true;
}

export interface SeedFormOptions {
  /** The `dataSources` key the record `$query` populates. Default `"record"`. */
  dataSource?: string;
  /** The state path the editable form copy is written to. Default `"form"`. */
  formPath?: string;
  /** Shape the copy before it lands in `state.form` (e.g. coerce dates, drop server fields). */
  transform?: (record: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Mirrors the first row of a record `$query` into `state.form`, and keeps it in step if the query
 * resolves again. With no row — the `new` entry point — the form is seeded as `{}` (the blank
 * template). Returns an unsubscribe function; call it when the view unmounts.
 *
 * Idempotent by content: a re-resolve that yields the same record does not write again, so the
 * subscription cannot loop through its own `setState`.
 */
export function seedFormFromRecord(store: StateStoreLike, options: SeedFormOptions = {}): () => void {
  const dataSource = options.dataSource ?? "record";
  const formPath = options.formPath ?? "form";
  let lastApplied: string | undefined;

  const apply = () => {
    const rows = getValue(store, `$data.${dataSource}.rows`);
    const first = Array.isArray(rows) && rows.length > 0 ? rows[0] : undefined;
    const raw = first && typeof first === "object" ? (first as Record<string, unknown>) : {};
    const next = options.transform ? options.transform(raw) : { ...raw };
    const fingerprint = JSON.stringify(next);
    if (fingerprint === lastApplied) return;
    lastApplied = fingerprint;
    store.setState(formPath, next);
  };

  apply();
  return store.subscribe ? store.subscribe(apply) : () => {};
}

/**
 * Wraps a `DataAdapter` so every list read decorates its rows with the route each row should open,
 * which is what a generated list document's
 * `navigate { route: { $bind: "event.route" } }` reads. `routeFor` maps a query (usually by
 * collection) to a route template, or `undefined` to leave the rows alone.
 */
export function withRowRoutes(adapter: DataAdapter, routeFor: (query: Query) => string | undefined): DataAdapter {
  return {
    query: async <T = Record<string, unknown>>(query: Query, signal?: AbortSignal) => {
      const result = await adapter.query<T>(query, signal);
      const template = routeFor(query);
      if (!template) return result;
      return { ...result, rows: decorateRowRoutes(result.rows as Record<string, unknown>[], template) as T[] };
    },
    get: (collection, id, signal) => adapter.get(collection, id, signal),
    create: (mutation, signal) => adapter.create(mutation, signal),
    update: (mutation, signal) => adapter.update(mutation, signal),
    remove: (collection, id, signal) => adapter.remove(collection, id, signal),
    transition: (mutation, signal) => adapter.transition(mutation, signal),
    report: (name, params, signal) => adapter.report(name, params, signal),
  };
}
