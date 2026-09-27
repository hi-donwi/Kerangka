/**
 * Kerangka In-Memory Event Bus Adapter for testing
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import { BusPort, EventMetadata } from "../bus.js";

export interface PublishedEvent {
  event: string;
  payload: unknown;
  metadata?: EventMetadata;
}

export class MemoryBus implements BusPort {
  readonly events: PublishedEvent[] = [];
  private handlers = new Map<
    string,
    Set<(payload: unknown, metadata?: EventMetadata) => Promise<void> | void>
  >();

  async publish(event: string, payload: unknown, metadata?: EventMetadata): Promise<void> {
    const entry: PublishedEvent = {
      event,
      payload,
      metadata: {
        timestamp: new Date().toISOString(),
        ...metadata,
      },
    };
    this.events.push(entry);

    const listeners = this.handlers.get(event);
    if (listeners) {
      for (const listener of listeners) {
        await listener(payload, entry.metadata);
      }
    }
  }

  subscribe(
    event: string,
    handler: (payload: unknown, metadata?: EventMetadata) => Promise<void> | void
  ): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);

    return () => {
      this.handlers.get(event)?.delete(handler);
    };
  }

  clear(): void {
    this.events.length = 0;
    this.handlers.clear();
  }
}
