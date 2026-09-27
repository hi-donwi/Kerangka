/**
 * Kerangka SQLite Store Adapter
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import { DatabaseSync } from "node:sqlite";
import { generateDDL, KIRDocument, toSnakeCase } from "@kerangka/compiler";
import { QueryFilter, QueryOptions, QueryResult, StorePort } from "@kerangka/ports";

export interface SqliteStoreOptions {
  dbPath?: string;
  database?: DatabaseSync;
  kir?: KIRDocument;
}

export class SqliteStore implements StorePort {
  readonly db: DatabaseSync;
  readonly kir?: KIRDocument;

  constructor(options: SqliteStoreOptions = {}) {
    this.kir = options.kir;
    this.db = options.database ?? new DatabaseSync(options.dbPath ?? ":memory:");
    this.db.exec("PRAGMA foreign_keys = ON;");
  }

  /**
   * Initializes the database tables and indexes from the provided KIR model.
   */
  initSchema(): void {
    if (!this.kir) {
      throw new Error("Cannot initialize schema: No KIR document was provided to SqliteStore");
    }
    const ddl = generateDDL(this.kir, { dialect: "sqlite" });
    this.db.exec(ddl);
  }

  async get<T = Record<string, unknown>>(
    entityName: string,
    id: string | number,
    options?: { tenantId?: string }
  ): Promise<T | null> {
    const tableName = toSnakeCase(entityName);
    const pkCol = this.getPkColumn(entityName);
    const tenantCol = this.getTenantColumn();

    let sql = `SELECT * FROM ${tableName} WHERE ${pkCol} = ?`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any[] = [id];

    if (tenantCol && options?.tenantId) {
      sql += ` AND ${tenantCol} = ?`;
      params.push(options.tenantId);
    }

    const stmt = this.db.prepare(sql);
    const row = stmt.get(...params) as Record<string, unknown> | undefined;

    if (!row) return null;
    return this.deserializeRow(entityName, row) as T;
  }

  async find<T = Record<string, unknown>>(
    entityName: string,
    filter?: QueryFilter,
    options?: QueryOptions
  ): Promise<QueryResult<T>> {
    const tableName = toSnakeCase(entityName);
    const tenantCol = this.getTenantColumn();

    const whereClauses: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any[] = [];

    if (tenantCol && options?.tenantId) {
      whereClauses.push(`${tenantCol} = ?`);
      params.push(options.tenantId);
    }

    if (filter) {
      for (const [k, v] of Object.entries(filter)) {
        whereClauses.push(`${toSnakeCase(k)} = ?`);
        params.push(v);
      }
    }

    const whereSql = whereClauses.length > 0 ? ` WHERE ${whereClauses.join(" AND ")}` : "";

    // Count total
    const countStmt = this.db.prepare(`SELECT COUNT(*) as count FROM ${tableName}${whereSql}`);
    const countRow = countStmt.get(...params) as { count: number };
    const total = countRow?.count ?? 0;

    // Fetch items
    let querySql = `SELECT * FROM ${tableName}${whereSql}`;

    if (options?.sort) {
      const orderClauses = Object.entries(options.sort).map(
        ([col, dir]) => `${toSnakeCase(col)} ${(dir as string).toUpperCase()}`
      );
      querySql += ` ORDER BY ${orderClauses.join(", ")}`;
    }

    if (options?.limit !== undefined) {
      querySql += ` LIMIT ${options.limit}`;
      if (options.offset !== undefined) {
        querySql += ` OFFSET ${options.offset}`;
      }
    }

    const fetchStmt = this.db.prepare(querySql);
    const rows = fetchStmt.all(...params) as Record<string, unknown>[];

    const items = rows.map((r) => this.deserializeRow(entityName, r) as T);

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
    const tableName = toSnakeCase(entityName);
    const tenantCol = this.getTenantColumn();

    const data: Record<string, unknown> = { ...record };
    if (tenantCol && options?.tenantId && !data[tenantCol] && !data.tenantId) {
      data[tenantCol] = options.tenantId;
    }

    if (options?.actor?.id) {
      data.createdBy = options.actor.id;
      data.updatedBy = options.actor.id;
    }

    const cols: string[] = [];
    const placeholders: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const values: any[] = [];

    for (const [k, v] of Object.entries(data)) {
      const colName = toSnakeCase(k);
      cols.push(colName);
      placeholders.push("?");
      values.push(this.serializeValue(v));
    }

    const sql = `INSERT INTO ${tableName} (${cols.join(", ")}) VALUES (${placeholders.join(", ")})`;
    const stmt = this.db.prepare(sql);
    stmt.run(...values);

    const pkCol = this.getPkColumn(entityName);
    const pkProp = this.kir?.entities[entityName]?.key ?? "id";
    const id = (data[pkProp] ?? data[pkCol]) as string | number;

    const created = await this.get<T>(entityName, id, { tenantId: options?.tenantId });
    return created!;
  }

  async update<T = Record<string, unknown>>(
    entityName: string,
    id: string | number,
    patch: Record<string, unknown>,
    options?: { tenantId?: string; actor?: { id?: string } }
  ): Promise<T> {
    const tableName = toSnakeCase(entityName);
    const pkCol = this.getPkColumn(entityName);
    const tenantCol = this.getTenantColumn();

    const sets: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const values: any[] = [];

    for (const [k, v] of Object.entries(patch)) {
      const colName = toSnakeCase(k);
      if (colName === pkCol) continue;
      sets.push(`${colName} = ?`);
      values.push(this.serializeValue(v));
    }

    sets.push("updated_at = datetime('now')");
    if (options?.actor?.id) {
      sets.push("updated_by = ?");
      values.push(options.actor.id);
    }

    let sql = `UPDATE ${tableName} SET ${sets.join(", ")} WHERE ${pkCol} = ?`;
    values.push(id);

    if (tenantCol && options?.tenantId) {
      sql += ` AND ${tenantCol} = ?`;
      values.push(options.tenantId);
    }

    const stmt = this.db.prepare(sql);
    stmt.run(...values);

    const updated = await this.get<T>(entityName, id, { tenantId: options?.tenantId });
    return updated!;
  }

  async delete(
    entityName: string,
    id: string | number,
    options?: { tenantId?: string; soft?: boolean; actor?: { id?: string } }
  ): Promise<boolean> {
    const tableName = toSnakeCase(entityName);
    const pkCol = this.getPkColumn(entityName);
    const tenantCol = this.getTenantColumn();

    let sql = `DELETE FROM ${tableName} WHERE ${pkCol} = ?`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any[] = [id];

    if (tenantCol && options?.tenantId) {
      sql += ` AND ${tenantCol} = ?`;
      params.push(options.tenantId);
    }

    const stmt = this.db.prepare(sql);
    stmt.run(...params);
    return true;
  }

  async transaction<R>(fn: (txStore: StorePort) => Promise<R>): Promise<R> {
    this.db.exec("BEGIN TRANSACTION;");
    try {
      const res = await fn(this);
      this.db.exec("COMMIT;");
      return res;
    } catch (err) {
      this.db.exec("ROLLBACK;");
      throw err;
    }
  }

  private getPkColumn(entityName: string): string {
    const prop = this.kir?.entities[entityName]?.key ?? "id";
    return toSnakeCase(prop);
  }

  private getTenantColumn(): string | null {
    if (this.kir?.multitenancy?.strategy === "discriminator") {
      return toSnakeCase(this.kir.multitenancy.field ?? "tenantId");
    }
    return null;
  }

  private serializeValue(val: unknown): unknown {
    if (val === null || val === undefined) return null;
    if (typeof val === "object") return JSON.stringify(val);
    if (typeof val === "boolean") return val ? 1 : 0;
    return val;
  }

  private deserializeRow(entityName: string, row: Record<string, unknown>): Record<string, unknown> {
    const entity = this.kir?.entities[entityName];
    const result: Record<string, unknown> = {};

    for (const [colName, val] of Object.entries(row)) {
      // Find matching entity field property
      const fieldProp = entity?.fields
        ? Object.keys(entity.fields).find((p) => toSnakeCase(p) === colName) ?? colName
        : colName;

      const fieldDef = entity?.fields?.[fieldProp];

      if (val === null || val === undefined) {
        result[fieldProp] = null;
        continue;
      }

      if (fieldDef?.type === "list" || (typeof val === "string" && (val.startsWith("[") || val.startsWith("{")))) {
        try {
          result[fieldProp] = JSON.parse(val as string);
          continue;
        } catch {
          // not valid json, fall through
        }
      }

      if (fieldDef?.type === "boolean" || fieldDef?.type === "bool") {
        result[fieldProp] = Boolean(val);
        continue;
      }

      result[fieldProp] = val;
    }

    return result;
  }
}
