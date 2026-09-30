/**
 * Kerangka sidecar session store
 *
 * The engine is pure: `run` returns effects, and something has to apply them
 * (PLAN.md §10, §11 L3). In the sidecar that something is this store — the smallest
 * honest host: aggregates in memory, one per sidecar process, gone when the process
 * exits. A real deployment replaces it with a database; the protocol does not change.
 *
 * Two things make it a host rather than a cache:
 *
 * 1. **A commit or nothing.** An execution's aggregates and its events are staged
 *    first and applied together. A persist effect that cannot be stored aborts the
 *    whole commit, so the session never holds half of a run.
 * 2. **An outbox.** Emitted events are queued for delivery rather than merely
 *    remembered. A host takes what is pending, delivers it, and acknowledges; a
 *    failure leaves the entry pending to be retried. The store never delivers
 *    anything itself — it cannot know what "delivered" means.
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

/** One queued event awaiting acknowledgement from a delivering host. */
export interface OutboxEntry {
  id: string;
  event: CloudEvent;
  /** Aggregates written in the same commit as this event, for a consumer that needs them. */
  entity?: string;
  attempts: number;
  state: "pending" | "delivered";
  lastError?: string;
  enqueuedAtRevision: number;
}

/**
 * One effect the host has to perform: a call, a notification, a timer. The store
 * never performs them — it cannot know what "delivered" means — but it queues them
 * the way it queues events, so a host that fails to dispatch one finds it still
 * waiting rather than gone.
 */
export interface HostEffectEntry {
  id: string;
  effect: Effect;
  attempts: number;
  state: "pending" | "delivered";
  lastError?: string;
  enqueuedAtRevision: number;
}

/** Raised when an execution's effects cannot be applied; nothing was written. */
export class EffectApplicationError extends Error {
  readonly code = "EFFECTS_NOT_APPLIED";

  constructor(
    message: string,
    readonly reason: "unaddressable" | "empty"
  ) {
    super(message);
    this.name = "EffectApplicationError";
  }
}

export interface CommitReport {
  /** Aggregates written. */
  persisted: number;
  /** Events queued in the outbox. */
  enqueued: number;
  /** Effects queued for the host to perform: calls, notifications, timers. */
  queuedEffects: number;
  /** Aggregate identifiers written, for a caller that wants to read one back. */
  ids: string[];
}

export interface SessionStoreOptions {
  /** Keep at most this many outbox entries; older delivered ones are dropped. Defaults to 500. */
  eventLogLimit?: number;
}

/**
 * What the sidecar protocol needs from a store. `SessionStore` is the in-memory one;
 * `SqliteSessionStore` is the durable one. The protocol does not change between them,
 * which is the whole point of writing it down.
 */
export interface SessionStoreLike {
  applyEffects(entity: string, effects: Effect[] | undefined, events: CloudEvent[] | undefined): CommitReport;
  get(entity: string, id: string): Record<string, unknown> | null;
  has(entity: string, id: string): boolean;
  list(entity: string): Record<string, unknown>[];
  revisionOf(entity: string, id: string): number | null;
  pending(): OutboxEntry[];
  ack(id: string): OutboxEntry | null;
  nack(id: string, error?: string): OutboxEntry | null;
  outboxEntry(id: string): OutboxEntry | null;
  events(type?: string): CloudEvent[];
  pendingEffects(type?: string): HostEffectEntry[];
  ackEffect(id: string): HostEffectEntry | null;
  nackEffect(id: string, error?: string): HostEffectEntry | null;
  hostEffect(id: string): HostEffectEntry | null;
  claim(idempotencyKey: string): boolean;
  claims(): string[];
  entities(): string[];
  clear(): void;
  put(entity: string, record: Record<string, unknown>): { entity: string; id: string; record: Record<string, unknown> };
}

export class SessionStore implements SessionStoreLike {
  private readonly rows = new Map<string, Map<string, StoredRecord>>();
  private readonly outbox = new Map<string, OutboxEntry>();
  private readonly hostEffects = new Map<string, HostEffectEntry>();
  private readonly outboxLimit: number;
  /** Idempotency keys already honoured (PLAN.md 7.7): event id plus policy name. */
  private readonly handled = new Set<string>();
  private revision = 0;

  constructor(options: SessionStoreOptions = {}) {
    this.outboxLimit = options.eventLogLimit ?? 500;
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
   * Apply the effects of a successful execution as one commit.
   *
   * A `persist` writes an aggregate, an `emit` queues its event, and everything else
   * (a call, a notification, a timer) is queued for the host to perform. The store
   * performs nothing itself — it cannot know what "delivered" means — but it does not
   * drop them either: a host that fails to dispatch one finds it still waiting.
   *
   * Staging first is what makes this a commit: nothing is written until every aggregate
   * in the batch is known to be storable, so a bad effect cannot leave half a run
   * behind.
   */
  applyEffects(entity: string, effects: Effect[] | undefined, events: CloudEvent[] | undefined): CommitReport {
    const staged: { entity: string; id: string; record: Record<string, unknown> }[] = [];
    // A call, a notification, a timer: the host's work, queued in the same commit as
    // the write that caused it, so the two cannot come apart.
    const dispatch: Effect[] = [];

    for (const effect of effects ?? []) {
      if (effect.type !== "persist") {
        // The event itself is queued from the run's events, not from its effect.
        if (effect.type !== "emit") dispatch.push(effect);
        continue;
      }
      const target = effect.entity ?? entity;
      const record = effect.record;
      if (!record) continue;
      const id = record.id;
      if (typeof id !== "string" || id.length === 0) {
        // Nothing is written: an aggregate that cannot be addressed cannot be kept, and
        // keeping half of a run would be worse than refusing all of it.
        throw new EffectApplicationError(
          `Cannot store a ${target}: the aggregate has no string 'id'`,
          "unaddressable"
        );
      }
      staged.push({ entity: target, id, record });
    }

    const queued = events ?? [];
    if (staged.length === 0 && queued.length === 0 && dispatch.length === 0) {
      return { persisted: 0, enqueued: 0, queuedEffects: 0, ids: [] };
    }

    const revision = this.revision;
    const writes = staged.map((row) => ({ ...row, revision: revision + 1 }));
    const entries = queued.map((event, index) => ({
      entry: {
        id: event.id ?? `outbox-${revision + 1}-${index}`,
        event,
        attempts: 0,
        state: "pending" as const,
        enqueuedAtRevision: revision + 1,
      },
      entity: staged[0]?.entity,
    }));

    // Everything is known good: commit.
    this.revision = revision + 1;
    for (const row of writes) {
      this.table(row.entity).set(row.id, { ...row, revision: this.revision });
    }
    const nextRevision = this.revision;
    const hostEntries = dispatch.map((effect, index) => ({
      id: `effect-${nextRevision + 1}-${index}`,
      effect,
      attempts: 0,
      state: "pending" as const,
      enqueuedAtRevision: nextRevision + 1,
    }));
    for (const { entry } of entries) {
      this.outbox.set(entry.id, entry);
    }
    for (const entry of hostEntries) {
      this.hostEffects.set(entry.id, entry);
    }
    this.trimOutbox();

    return {
      persisted: writes.length,
      enqueued: entries.length,
      queuedEffects: hostEntries.length,
      ids: writes.map((w) => w.id),
    };
  }

  private trimOutbox(): void {
    if (this.outbox.size <= this.outboxLimit) return;
    for (const [id, entry] of this.outbox) {
      if (this.outbox.size <= this.outboxLimit) break;
      if (entry.state === "delivered") {
        this.outbox.delete(id);
      }
    }
    // Every entry is still pending: the limit is a safety net, not a delivery policy.
    // Dropping a pending event would lose it, so the oldest pending is kept.
  }

  /**
   * Claim an idempotency key. The first claim wins; a replay of the same event against
   * the same policy is told it was already handled, which is what makes at-least-once
   * delivery safe (PLAN.md §7.7).
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
      throw new EffectApplicationError(
        `Cannot store a ${entity}: the aggregate has no string 'id'`,
        "unaddressable"
      );
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

  // -- Outbox -----------------------------------------------------------------

  /** Events still waiting for a host to deliver them, oldest first. */
  pending(): OutboxEntry[] {
    return [...this.outbox.values()]
      .filter((entry) => entry.state === "pending")
      .sort((a, b) => a.enqueuedAtRevision - b.enqueuedAtRevision);
  }

  /**
   * A host delivered an event. Kept as history rather than deleted, so a duplicate
   * acknowledgement or a late `nack` is visible instead of silent.
   */
  ack(id: string): OutboxEntry | null {
    const entry = this.outbox.get(id);
    if (!entry) return null;
    entry.state = "delivered";
    entry.lastError = undefined;
    this.trimOutbox();
    return entry;
  }

  /**
   * Delivery failed. The entry stays pending to be retried, and the attempt is counted
   * so a host can give up or alert. Nothing is lost: the event is still in the outbox.
   */
  nack(id: string, error?: string): OutboxEntry | null {
    const entry = this.outbox.get(id);
    if (!entry) return null;
    entry.state = "pending";
    entry.attempts += 1;
    if (error !== undefined) entry.lastError = error;
    return entry;
  }

  outboxEntry(id: string): OutboxEntry | null {
    return this.outbox.get(id) ?? null;
  }

  /** Every event this session emitted, delivered or not, oldest first. */
  events(type?: string): CloudEvent[] {
    const all = [...this.outbox.values()].sort(
      (a, b) => a.enqueuedAtRevision - b.enqueuedAtRevision
    );
    const events = all.map((entry) => entry.event);
    return type ? events.filter((e) => e.type === type) : events;
  }

  // -- Host effects -----------------------------------------------------------

  /**
   * Effects still waiting for a host to perform them, oldest first: a `call` to an
   * extension, a notification, a scheduled timer.
   */
  pendingEffects(type?: string): HostEffectEntry[] {
    return [...this.hostEffects.values()]
      .filter((entry) => entry.state === "pending")
      .filter((entry) => (type ? entry.effect.type === type : true))
      .sort((a, b) => a.enqueuedAtRevision - b.enqueuedAtRevision);
  }

  /** The host performed the effect. Kept as history, like a delivered event. */
  ackEffect(id: string): HostEffectEntry | null {
    const entry = this.hostEffects.get(id);
    if (!entry) return null;
    entry.state = "delivered";
    entry.lastError = undefined;
    return entry;
  }

  /**
   * The host could not perform the effect. It stays pending to be retried, and the
   * attempt is counted so a host can alert instead of retrying forever in silence.
   */
  nackEffect(id: string, error?: string): HostEffectEntry | null {
    const entry = this.hostEffects.get(id);
    if (!entry) return null;
    entry.state = "pending";
    entry.attempts += 1;
    if (error !== undefined) entry.lastError = error;
    return entry;
  }

  hostEffect(id: string): HostEffectEntry | null {
    return this.hostEffects.get(id) ?? null;
  }

  entities(): string[] {
    return [...this.rows.keys()].filter((entity) => (this.rows.get(entity)?.size ?? 0) > 0);
  }

  clear(): void {
    this.rows.clear();
    this.outbox.clear();
    this.hostEffects.clear();
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
  snapshot(): {
    entities: Record<string, number>;
    events: number;
    pending: number;
    claims: string[];
  } {
    return {
      entities: this.summary(),
      events: this.outbox.size,
      pending: this.pending().length,
      claims: this.claims(),
    };
  }
}
