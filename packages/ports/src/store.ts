/**
 * Kerangka Store Port Contract
 * Specification Version: 0.2
 * Status: Draft
 * License: Apache-2.0
 */

export interface AuditMetadata {
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
}

/**
 * A query predicate: the plan's `where` node, which is the tuple AST the engine uses.
 *
 * Typed as `unknown` on purpose. The node union — `["and", …]`, `["get", "name"]`, a literal —
 * belongs to `engine-ts`, and `ports` must not grow a dependency on it to name it. Narrowing
 * this to `readonly unknown[]` was tried and is wrong: a plan's `where` may be any node,
 * including a literal, so the narrower type rejects a perfectly good call and buys nothing. A
 * type that is `unknown` but says what a store must do with it is more use than one that is
 * precise about a shape `ports` is not in a position to know.
 *
 * The obligation is the part that matters: see `QueryOptions.where`. Anything a store does not
 * recognise carries no constraint, and a store must not treat an unrecognised node as a reason
 * to return fewer rows.
 */
export type QueryPredicate = unknown;

export interface QueryOptions {
  tenantId?: string;
  limit?: number;
  offset?: number;
  sort?: Record<string, "asc" | "desc">;
  includeSoftDeleted?: boolean;

  /**
   * The plan's full predicate, offered to the store so it can narrow the scan.
   *
   * **Advisory, and narrowing only.** A store may apply any part of this that it can prove is
   * implied by the predicate, and must otherwise ignore it. It may return a superset; it may
   * never return a subset, because a store that is stricter than the engine returns fewer rows
   * than the model promises and nothing reports the difference. The adapter re-evaluates the
   * full predicate over whatever comes back, which is what makes a partial pushdown correct.
   *
   * Equality continues to travel in `QueryFilter`, which every store honours. A store reading
   * this does not need to handle `==` here; see ADR-0039 for why the filter is not widened.
   */
  where?: QueryPredicate;
}

export interface QueryFilter {
  [field: string]: unknown;
}

export interface QueryResult<T = Record<string, unknown>> {
  items: T[];
  total: number;
  limit?: number;
  offset?: number;
}

export interface OutboxMessage {
  id: string;
  eventType: string;
  payload: unknown;
  aggregateId?: string;
  aggregateType?: string;
  tenantId?: string;
  createdAt?: string;
  dispatchedAt?: string;
}

export interface TimerEntry {
  id: string;
  target: string;
  payload?: unknown;
  triggerAt: string;
  dispatchedAt?: string;
}

export class VersionConflictError extends Error {
  readonly code = "VERSION_CONFLICT";
  readonly entityName?: string;
  readonly recordId?: string;
  readonly expectedVersion?: number;
  readonly actualVersion?: number;

  constructor(
    entityName?: string,
    recordId?: string,
    expectedVersion?: number,
    actualVersion?: number,
    message?: string
  ) {
    const defaultMsg =
      entityName && recordId
        ? `Version conflict on ${entityName}:${recordId} (expected ${expectedVersion}, got ${actualVersion})`
        : "Record version conflict: expected version does not match current version";
    super(message ?? defaultMsg);
    this.name = "VersionConflictError";
    this.entityName = entityName;
    this.recordId = recordId;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

export interface StorePort {
  /**
   * Retrieves a single entity record by its unique key.
   */
  get<T = Record<string, unknown>>(
    entityName: string,
    id: string | number,
    options?: { tenantId?: string }
  ): Promise<T | null>;

  /**
   * Finds records matching an optional query filter and pagination options.
   */
  find<T = Record<string, unknown>>(
    entityName: string,
    filter?: QueryFilter,
    options?: QueryOptions
  ): Promise<QueryResult<T>>;

  /**
   * Persists a new entity record.
   */
  create<T = Record<string, unknown>>(
    entityName: string,
    record: Record<string, unknown>,
    options?: { tenantId?: string; actor?: { id?: string } }
  ): Promise<T>;

  /**
   * Updates an existing entity record by ID with optional optimistic concurrency version check.
   */
  update<T = Record<string, unknown>>(
    entityName: string,
    id: string | number,
    patch: Record<string, unknown>,
    options?: { tenantId?: string; actor?: { id?: string }; expectedVersion?: number }
  ): Promise<T>;

  /**
   * Deletes a record by ID (supports soft delete if configured in entity model).
   */
  delete(
    entityName: string,
    id: string | number,
    options?: { tenantId?: string; soft?: boolean; actor?: { id?: string } }
  ): Promise<boolean>;

  /**
   * Executes a callback within an isolated ACID transaction.
   */
  transaction<R>(fn: (txStore: StorePort) => Promise<R>): Promise<R>;

  // Transactional Outbox (ADR-0023 / PLAN.md §8.1)
  enqueueOutbox(message: OutboxMessage): Promise<void>;
  fetchPendingOutbox(limit?: number): Promise<OutboxMessage[]>;
  markOutboxDispatched(id: string): Promise<void>;

  // Database Timer Table (ADR-0015 / PLAN.md §8.1)
  enqueueTimer(entry: TimerEntry): Promise<void>;
  fetchDueTimers(now?: string | Date, limit?: number): Promise<TimerEntry[]>;
  markTimerDispatched(id: string): Promise<void>;
}
