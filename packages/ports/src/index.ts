/**
 * @kerangka/ports
 * Standard runtime port contracts and in-memory test adapters for Kerangka.
 *
 * Status: Draft 0.1
 * License: Apache-2.0
 */

export * from "./store.js";
export * from "./cache.js";
export * from "./bus.js";
export * from "./scheduler.js";
export * from "./realtime.js";
export * from "./files.js";
export * from "./connectors.js";
export * from "./secrets.js";
export * from "./telemetry.js";
export * from "./client-store.js";

// In-Memory Test Adapters
export * from "./memory/memory-store.js";
export * from "./memory/memory-bus.js";
export * from "./memory/memory-cache.js";
export * from "./memory/memory-secrets.js";

// Built-in Connectors & Registry
export * from "./connectors/http.js";
export * from "./connectors/sequence.js";
export * from "./connectors/email.js";
export * from "./connectors/registry.js";

// Transactional Outbox Bus
export * from "./outbox-bus.js";

