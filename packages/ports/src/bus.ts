/**
 * Kerangka Event Bus Port Contract
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

export interface EventMetadata {
  id?: string;
  timestamp?: string;
  source?: string;
  tenantId?: string;
  correlationId?: string;
  [key: string]: unknown;
}

export interface BusPort {
  /**
   * Publishes an event to the bus.
   */
  publish(event: string, payload: unknown, metadata?: EventMetadata): Promise<void>;

  /**
   * Subscribes a handler to a specific event or wildcard pattern.
   * Returns an unsubscribe function.
   */
  subscribe(
    event: string,
    handler: (payload: unknown, metadata?: EventMetadata) => Promise<void> | void
  ): () => void;
}
