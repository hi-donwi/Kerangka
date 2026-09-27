/**
 * Kerangka PostgreSQL Store Adapter
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import { generateDDL, KIRDocument, toSnakeCase } from "@kerangka/compiler";
import { QueryFilter, QueryOptions, QueryResult, StorePort } from "@kerangka/ports";
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
  }

  async get<T = Record<string, unknown>>(
    entityName: string,
    id: string | number,
    options?: { tenantId?: string }
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
    options?: { tenantId?: string; actor?: { id?: string } }
  ): Promise<T> {
    const q = this.builder.buildUpdate(entityName, id, patch, options);
    const res = await this.executor.query<Record<string, unknown>>(q.sql, q.values);
    const row = res.rows[0];
    return this.deserializeRow(entityName, row!) as T;
  }

  async delete(
    entityName: string,
    id: string | number,
    options?: { tenantId?: string }
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
