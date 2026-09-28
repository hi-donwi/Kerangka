/**
 * Kerangka Database Outbox Bus Adapter
 * Specification Version: 0.2
 * Status: Draft
 * License: Apache-2.0
 */

import { randomUUID } from "node:crypto";
import { BusPort, EventMetadata } from "./bus.js";
import { OutboxMessage, StorePort } from "./store.js";

export type EventHandler = (payload: unknown, metadata?: EventMetadata) => Promise<void> | void;

export interface DatabaseOutboxBusOptions {
  store: StorePort;
  /**
   * If true (default), immediately delivers to in-process subscribers during publish
   * and marks the outbox message dispatched.
   * If false, messages remain in the outbox until pollAndDispatch() is called.
   */
  immediateDispatch?: boolean;
}

export class DatabaseOutboxBus implements BusPort {
  readonly store: StorePort;
  private readonly immediateDispatch: boolean;
  private readonly handlers = new Map<string, Set<EventHandler>>();

  constructor(options: DatabaseOutboxBusOptions) {
    this.store = options.store;
    this.immediateDispatch = options.immediateDispatch ?? true;
  }

  /**
   * Publishes an event by persisting it to the outbox table.
   * If immediateDispatch is enabled, dispatches to matching in-process subscribers.
   */
  async publish(event: string, payload: unknown, metadata?: EventMetadata): Promise<void> {
    const id = metadata?.id ?? randomUUID();
    const createdAt = metadata?.timestamp ?? new Date().toISOString();

    const message: OutboxMessage = {
      id,
      eventType: event,
      payload,
      tenantId: metadata?.tenantId,
      createdAt,
    };

    await this.store.enqueueOutbox(message);

    if (this.immediateDispatch) {
      await this.dispatchToHandlers(event, payload, metadata);
      await this.store.markOutboxDispatched(id);
    }
  }

  /**
   * Subscribes a handler to a specific event or wildcard pattern (e.g. "billing:*", "*").
   */
  subscribe(event: string, handler: EventHandler): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);

    return () => {
      const set = this.handlers.get(event);
      if (set) {
        set.delete(handler);
        if (set.size === 0) {
          this.handlers.delete(event);
        }
      }
    };
  }

  /**
   * Polls pending outbox records from the store, dispatches them to matching handlers,
   * and marks them as dispatched.
   * Returns the count of dispatched messages.
   */
  async pollAndDispatch(limit = 100): Promise<number> {
    const pending = await this.store.fetchPendingOutbox(limit);
    let count = 0;

    for (const msg of pending) {
      const meta: EventMetadata = {
        id: msg.id,
        timestamp: msg.createdAt,
        tenantId: msg.tenantId,
        source: msg.eventType,
      };

      await this.dispatchToHandlers(msg.eventType, msg.payload, meta);
      await this.store.markOutboxDispatched(msg.id);
      count++;
    }

    return count;
  }

  /**
   * Starts periodic polling in the background.
   * Returns a cleanup function to stop the poller.
   */
  startPolling(intervalMs = 1000, limit = 100): () => void {
    const timer = setInterval(async () => {
      try {
        await this.pollAndDispatch(limit);
      } catch (err) {
        // Suppress or log background polling errors
        console.error("DatabaseOutboxBus polling error:", err);
      }
    }, intervalMs);

    return () => {
      clearInterval(timer);
    };
  }

  private async dispatchToHandlers(
    event: string,
    payload: unknown,
    metadata?: EventMetadata
  ): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [pattern, handlers] of this.handlers.entries()) {
      if (this.matchesTopic(pattern, event)) {
        for (const handler of handlers) {
          try {
            const res = handler(payload, metadata);
            if (res instanceof Promise) {
              promises.push(res);
            }
          } catch (err) {
            console.error(`Error in event handler for "${event}":`, err);
          }
        }
      }
    }

    if (promises.length > 0) {
      await Promise.allSettled(promises);
    }
  }

  private matchesTopic(pattern: string, event: string): boolean {
    if (pattern === "*" || pattern === event) {
      return true;
    }

    if (pattern.includes("*")) {
      const regexStr = "^" + pattern.split("*").map((s) => s.replace(/[-[\]{}()+?.,\\^$|#\s]/g, "\\$&")).join(".*") + "$";
      return new RegExp(regexStr).test(event);
    }

    return false;
  }
}
