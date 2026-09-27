/**
 * @kerangka/engine-ts
 * Pure TypeScript reference execution engine for Kerangka models.
 *
 * Status: Draft 0.1
 * License: Apache-2.0
 */

export * from "./types.js";
export * from "./engine.js";

import { Engine } from "./engine.js";

/**
 * Creates and loads a new Kerangka execution engine from compiled KIR.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadEngine(ir: any): Engine {
  return new Engine(ir);
}
