/**
 * Kerangka Store Port Contract
 * Specification Version: 0.1
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
   * Updates an existing entity record by ID.
   */
  update<T = Record<string, unknown>>(
    entityName: string,
    id: string | number,
    patch: Record<string, unknown>,
    options?: { tenantId?: string; actor?: { id?: string } }
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
}
