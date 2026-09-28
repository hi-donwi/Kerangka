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

export interface QueryOptions {
  tenantId?: string;
  limit?: number;
  offset?: number;
  sort?: Record<string, "asc" | "desc">;
  includeSoftDeleted?: boolean;
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
