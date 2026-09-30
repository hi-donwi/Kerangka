/**
 * Kerangka sidecar session store
 *
 * The engine is pure: `run` returns effects, and something has to apply them
 * (PLAN.md §10, §11 L3). In the sidecar that something is this store — the smallest
 * honest host: aggregates in memory, one per sidecar process, gone when the process
 * exits. A real deployment replaces it with a database; the protocol does not change.
 *
 * It is deliberately not part of the engine and not a Runtime API method. Nothing here
 * decides anything; it only records what the engine already decided.
 */

import type { CloudEvent, Effect } from "@kerangka/engine-ts";

interface StoredRecord {
  entity: string;
  id: string;
  record: Record<string, unknown>;
  /** Monotonic per store, so a host can detect its own lost update. */
  revision: number;
}

export interface SessionStoreOptions {
  /** Keep at most this many emitted events; older ones are dropped. Defaults to 500. */
  eventLogLimit?: number;
}

export class SessionStore {
  private readonly rows = new Map<string, Map<string, StoredRecord>>();
  private readonly eventLog: CloudEvent[] = [];
  private readonly eventLogLimit: number;
  /** Idempotency keys already honoured (PLAN.md 7.7): event id plus policy name. */
  private readonly handled = new Set<string>();
  private revision = 0;

  constructor(options: SessionStoreOptions = {}) {
    this.eventLogLimit = options.eventLogLimit ?? 500;
  }

  private table(entity: string): Map<string, StoredRecord> {
    let rows = this.rows.get(entity);
    if (!rows) {
      rows = new Map<string, StoredRecord>();
      this.rows.set(entity, rows);
    }
    return rows;
  }

  /**
   * Apply the effects of a successful execution. A `persist` writes the aggregate; an
   * `emit` appends to the event log. Every other effect type is the host's business
   * (mail, timers, external calls) and is deliberately dropped here.
   */
  applyEffects(entity: string, effects: Effect[] | undefined, events: CloudEvent[] | undefined): void {
    for (const effect of effects ?? []) {
      if (effect.type !== "persist") continue;
      const target = effect.entity ?? entity;
      const record = effect.record;
      if (!record) continue;
      const id = record.id;
      if (typeof id !== "string" || id.length === 0) {
        // An aggregate without an id cannot be addressed, so it cannot be stored.
        continue;
      }
      this.revision += 1;
      this.table(target).set(id, {
        entity: target,
        id,
        record,
        revision: this.revision,
      });
    }

    for (const event of events ?? []) {
      this.eventLog.push(event);
      while (this.eventLog.length > this.eventLogLimit) {
        this.eventLog.shift();
      }
    }
  }

  /**
   * Claim an idempotency key. The first claim wins; a replay of the same event against
   * the same policy is told it was already handled, which is what makes at-least-once
   * delivery safe (PLAN.md 7.7).
   */
  claim(idempotencyKey: string): boolean {
    if (this.handled.has(idempotencyKey)) {
      return false;
    }
    this.handled.add(idempotencyKey);
    return true;
  }

  hasClaimed(idempotencyKey: string): boolean {
    return this.handled.has(idempotencyKey);
  }

  claims(): string[] {
    return [...this.handled];
  }

  /** Write a record directly, for a host seeding the session or a test. */
  put(entity: string, record: Record<string, unknown>): StoredRecord {
    const id = record.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(`Cannot store a ${entity} without a string 'id'`);
    }
    this.revision += 1;
    const row: StoredRecord = { entity, id, record, revision: this.revision };
    this.table(entity).set(id, row);
    return row;
  }

  get(entity: string, id: string): Record<string, unknown> | null {
    return this.rows.get(entity)?.get(id)?.record ?? null;
  }

  has(entity: string, id: string): boolean {
    return this.rows.get(entity)?.has(id) ?? false;
  }

  list(entity: string): Record<string, unknown>[] {
    return [...(this.rows.get(entity)?.values() ?? [])].map((row) => row.record);
  }

  revisionOf(entity: string, id: string): number | null {
    return this.rows.get(entity)?.get(id)?.revision ?? null;
  }

  /** Emitted events, oldest first, optionally filtered by CloudEvent `type`. */
  events(type?: string): CloudEvent[] {
    return type ? this.eventLog.filter((e) => e.type === type) : [...this.eventLog];
  }

  entities(): string[] {
    return [...this.rows.keys()].filter((entity) => (this.rows.get(entity)?.size ?? 0) > 0);
  }

  clear(): void {
    this.rows.clear();
    this.eventLog.length = 0;
    this.handled.clear();
  }

  /** A snapshot for `describe`, so a client can see what the session holds. */
  summary(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [entity, table] of this.rows) {
      if (table.size > 0) out[entity] = table.size;
    }
    return out;
  }

  /** A snapshot a client can read to see what the session holds. */
  snapshot(): { entities: Record<string, number>; events: number; claims: string[] } {
    return {
      entities: this.summary(),
      events: this.eventLog.length,
      claims: this.claims(),
    };
  }
}
