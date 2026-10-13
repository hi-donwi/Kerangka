/**
 * @kerangka/uidl-projector
 * Compiles a Kerangka model's dashboard, list, and form views into UIDL screens per request,
 * through uidl-runtime's page recipes (ADR-0045). It imports `uidl-runtime/recipes` only, whose
 * module graph has no React.
 *
 * License: Apache-2.0
 */

export * from "./project.js";
