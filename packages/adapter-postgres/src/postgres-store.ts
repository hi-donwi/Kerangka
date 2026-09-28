/**
 * Kerangka PostgreSQL Store Adapter
 * Specification Version: 0.2
 * Status: Draft
 * License: Apache-2.0
 */

import { generateDDL, KIRDocument, toSnakeCase } from "@kerangka/compiler";
import {
  OutboxMessage,
  QueryFilter,
  QueryOptions,
  QueryResult,
  StorePort,
  TimerEntry,
  VersionConflictError,
} from "@kerangka/ports";
import { PostgresQueryBuilder } from "./query-builder.js";

export interface PostgresExecutor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<R = any>(sql: string, params?: any[]): Promise<{ rows: R[] }>;
}

export interface PostgresStoreOptions {
  executor: PostgresExecutor;
  kir?: KIRDocument;
}

export class PostgresStore implements StorePort {
  readonly executor: PostgresExecutor;
  readonly kir?: KIRDocument;
  readonly builder: PostgresQueryBuilder;

  constructor(options: PostgresStoreOptions) {
    this.executor = options.executor;
    this.kir = options.kir;
    this.builder = new PostgresQueryBuilder(options.kir);
  }

  /**
   * Initializes PostgreSQL schema DDL.
   */
  async initSchema(options?: { schema?: string }): Promise<void> {
    if (!this.kir) {
      throw new Error("Cannot initialize schema: No KIR document was provided to PostgresStore");
    }
    const ddl = generateDDL(this.kir, { dialect: "postgres", schema: options?.schema });
    await this.executor.query(ddl);
    await this.initInternalTables();
  }

  /**
   * Initializes outbox and timer tables if they do not exist.
   */
  async initInternalTables(): Promise<void> {
    const sql = `
      CREATE TABLE IF NOT EXISTS _outbox (
        id VARCHAR(255) PRIMARY KEY,
        event_type VARCHAR(255) NOT NULL,
        payload JSONB NOT NULL,
        aggregate_id VARCHAR(255),
        aggregate_type VARCHAR(255),
        tenant_id VARCHAR(255),
        created_at TIMESTAMPTZ NOT NULL,
        dispatched_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS _timers (
        id VARCHAR(255) PRIMARY KEY,
        target VARCHAR(255) NOT NULL,
        payload JSONB,
        trigger_at TIMESTAMPTZ NOT NULL,
        dispatched_at TIMESTAMPTZ
      );
    `;
    await this.executor.query(sql);
  }

  async get<T = Record<string, unknown>>(
    entityName: string,
    id: string | number,
    options?: { tenantId?: string; includeSoftDeleted?: boolean }
  ): Promise<T | null> {
    const q = this.builder.buildGet(entityName, id, options);
    const res = await this.executor.query<Record<string, unknown>>(q.sql, q.values);
    const row = res.rows[0];
    if (!row) return null;
    return this.deserializeRow(entityName, row) as T;
  }

  async find<T = Record<string, unknown>>(
    entityName: string,
    filter?: QueryFilter,
    options?: QueryOptions
  ): Promise<QueryResult<T>> {
    const { dataQuery, countQuery } = this.builder.buildFind(entityName, filter, options);

    const [dataRes, countRes] = await Promise.all([
      this.executor.query<Record<string, unknown>>(dataQuery.sql, dataQuery.values),
      this.executor.query<{ count: string | number }>(countQuery.sql, countQuery.values),
    ]);

    const total = parseInt(String(countRes.rows[0]?.count ?? "0"), 10);
    const items = dataRes.rows.map((r) => this.deserializeRow(entityName, r) as T);

    return {
      items,
      total,
      limit: options?.limit,
      offset: options?.offset,
    };
  }

  async create<T = Record<string, unknown>>(
    entityName: string,
    record: Record<string, unknown>,
    options?: { tenantId?: string; actor?: { id?: string } }
  ): Promise<T> {
    const q = this.builder.buildInsert(entityName, record, options);
    const res = await this.executor.query<Record<string, unknown>>(q.sql, q.values);
    const row = res.rows[0];
    return this.deserializeRow(entityName, row!) as T;
  }

  async update<T = Record<string, unknown>>(
    entityName: string,
    id: string | number,
    patch: Record<string, unknown>,
    options?: { tenantId?: string; actor?: { id?: string }; expectedVersion?: number }
  ): Promise<T> {
    const q = this.builder.buildUpdate(entityName, id, patch, options);
    const res = await this.executor.query<Record<string, unknown>>(q.sql, q.values);
    const row = res.rows[0];

    if (!row) {
      if (options?.expectedVersion !== undefined) {
        const current = await this.get<Record<string, unknown>>(entityName, id, {
          tenantId: options.tenantId,
          includeSoftDeleted: true,
        });
        if (current) {
          const currentVersion = (current.version as number | undefined) ?? 1;
          throw new VersionConflictError(entityName, String(id), options.expectedVersion, currentVersion);
        }
      }
      throw new Error(`Record ${entityName} with id ${id} not found`);
    }

    return this.deserializeRow(entityName, row!) as T;
  }

  async delete(
    entityName: string,
    id: string | number,
    options?: { tenantId?: string; soft?: boolean; actor?: { id?: string } }
  ): Promise<boolean> {
    const q = this.builder.buildDelete(entityName, id, options);
    await this.executor.query(q.sql, q.values);
    return true;
  }

  async transaction<R>(fn: (txStore: StorePort) => Promise<R>): Promise<R> {
    await this.executor.query("BEGIN;");
    try {
      const res = await fn(this);
      await this.executor.query("COMMIT;");
      return res;
    } catch (err) {
      await this.executor.query("ROLLBACK;");
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Outbox Operations (ADR-0023 / PLAN.md §8.1)
  // ---------------------------------------------------------------------------

  async enqueueOutbox(message: OutboxMessage): Promise<void> {
    const q = this.builder.buildEnqueueOutbox(message);
    await this.executor.query(q.sql, q.values);
  }

  async fetchPendingOutbox(limit = 100): Promise<OutboxMessage[]> {
    const q = this.builder.buildFetchPendingOutbox(limit);
    const res = await this.executor.query<Record<string, unknown>>(q.sql, q.values);
    return res.rows.map((r) => ({
      id: r.id as string,
      eventType: (r.event_type ?? r.eventType) as string,
      payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
      aggregateId: (r.aggregate_id ?? r.aggregateId) as string | undefined,
      aggregateType: (r.aggregate_type ?? r.aggregateType) as string | undefined,
      tenantId: (r.tenant_id ?? r.tenantId) as string | undefined,
      createdAt: (r.created_at ?? r.createdAt) as string,
      dispatchedAt: (r.dispatched_at ?? r.dispatchedAt) as string | undefined,
    }));
  }

  async markOutboxDispatched(id: string): Promise<void> {
    const q = this.builder.buildMarkOutboxDispatched(id);
    await this.executor.query(q.sql, q.values);
  }

  // ---------------------------------------------------------------------------
  // Timer Operations (ADR-0015 / PLAN.md §8.1)
  // ---------------------------------------------------------------------------

  async enqueueTimer(entry: TimerEntry): Promise<void> {
    const q = this.builder.buildEnqueueTimer(entry);
    await this.executor.query(q.sql, q.values);
  }

  async fetchDueTimers(now: string, limit = 100): Promise<TimerEntry[]> {
    const q = this.builder.buildFetchDueTimers(now, limit);
    const res = await this.executor.query<Record<string, unknown>>(q.sql, q.values);
    return res.rows.map((r) => ({
      id: r.id as string,
      target: r.target as string,
      payload: r.payload ? (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) : undefined,
      triggerAt: (r.trigger_at ?? r.triggerAt) as string,
      dispatchedAt: (r.dispatched_at ?? r.dispatchedAt) as string | undefined,
    }));
  }

  async markTimerDispatched(id: string): Promise<void> {
    const q = this.builder.buildMarkTimerDispatched(id);
    await this.executor.query(q.sql, q.values);
  }

  private deserializeRow(entityName: string, row: Record<string, unknown>): Record<string, unknown> {
    const entity = this.kir?.entities[entityName];
    const result: Record<string, unknown> = {};

    for (const [colName, val] of Object.entries(row)) {
      const fieldProp = entity?.fields
        ? Object.keys(entity.fields).find((p) => toSnakeCase(p) === colName) ?? colName
        : colName;

      result[fieldProp] = val;
    }

    return result;
  }
}
