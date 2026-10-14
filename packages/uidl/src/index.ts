/**
 * @kerangka/uidl
 * The host bridge between a UIDL document (uidl.dev) and a running Kerangka server.
 *
 * A generated Kerangka app emits UIDL documents (`@kerangka/compiler`'s `generateUIDL`). To render
 * one against a real backend you provide the UIDL-Runtime with two things this package builds:
 * a `DataAdapter` that reads and writes through Kerangka's compiled REST semantics, and a
 * `MutationHandler` that executes the document's `mutate` actions. Neither has any runtime
 * dependency beyond `fetch`, and neither imports UIDL-Runtime — the seam is structural, so the
 * same objects drop straight into `UIDocumentRenderer`.
 *
 * Specification Version: 1.x
 * License: Apache-2.0
 */

export * from "./types.js";
export * from "./errors.js";
export * from "./http.js";
export * from "./query.js";
export * from "./adapter.js";
export * from "./mutation-handler.js";
export * from "./routes.js";
export * from "./wiring.js";
export * from "./stream.js";
export * from "./screens.js";
