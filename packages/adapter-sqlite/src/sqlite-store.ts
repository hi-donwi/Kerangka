/**
 * Kerangka SQLite Store Adapter
 * Specification Version: 0.2
 * Status: Draft
 * License: Apache-2.0
 */

import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
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

export interface SqliteStoreOptions {
  dbPath?: string;
  database?: DatabaseSync;
  kir?: KIRDocument;
}

export class SqliteStore implements StorePort {
  readonly db: DatabaseSync;
  readonly kir?: KIRDocument;
  private inTransaction = false;

  constructor(options: SqliteStoreOptions = {}) {
    this.kir = options.kir;
    this.db = options.database ?? new DatabaseSync(options.dbPath ?? ":memory:");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.initInternalTables();
  }

  /**
   * Initializes the internal outbox and timers tables.
   */
  private initInternalTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _outbox (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        aggregate_id TEXT,
        aggregate_type TEXT,
        tenant_id TEXT,
        created_at TEXT NOT NULL,
        dispatched_at TEXT
      );
      CREATE TABLE IF NOT EXISTS _timers (
        id TEXT PRIMARY KEY,
        target TEXT NOT NULL,
        payload TEXT,
        trigger_at TEXT NOT NULL,
        dispatched_at TEXT
      );
    `);
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
    options?: { tenantId?: string; includeSoftDeleted?: boolean }
  ): Promise<T | null> {
    const tableName = toSnakeCase(entityName);
    if (!this.tableExists(tableName)) return null;

    const pkCol = this.getPkColumn(entityName);
    const tenantCol = this.getTenantColumn();

    let sql = `SELECT * FROM "${tableName}" WHERE "${pkCol}" = ?`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any[] = [id];

    if (tenantCol && options?.tenantId && this.hasColumn(tableName, tenantCol)) {
      sql += ` AND "${tenantCol}" = ?`;
      params.push(options.tenantId);
    }

    if (!options?.includeSoftDeleted && this.hasColumn(tableName, "deleted")) {
      sql += ` AND ("deleted" = 0 OR "deleted" IS NULL)`;
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
    if (!this.tableExists(tableName)) {
      return { items: [], total: 0, limit: options?.limit, offset: options?.offset };
    }

    const tenantCol = this.getTenantColumn();
    const whereClauses: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any[] = [];

    if (tenantCol && options?.tenantId && this.hasColumn(tableName, tenantCol)) {
      whereClauses.push(`"${tenantCol}" = ?`);
      params.push(options.tenantId);
    }

    if (!options?.includeSoftDeleted && this.hasColumn(tableName, "deleted")) {
      whereClauses.push(`("deleted" = 0 OR "deleted" IS NULL)`);
    }

    if (filter) {
      for (const [k, v] of Object.entries(filter)) {
        whereClauses.push(`"${toSnakeCase(k)}" = ?`);
        params.push(v);
      }
    }

    const whereSql = whereClauses.length > 0 ? ` WHERE ${whereClauses.join(" AND ")}` : "";

    // Count total
    const countStmt = this.db.prepare(`SELECT COUNT(*) as count FROM "${tableName}"${whereSql}`);
    const countRow = countStmt.get(...params) as { count: number };
    const total = countRow?.count ?? 0;

    // Fetch items
    let querySql = `SELECT * FROM "${tableName}"${whereSql}`;

    if (options?.sort) {
      const orderClauses = Object.entries(options.sort).map(
        ([col, dir]) => `"${toSnakeCase(col)}" ${(dir as string).toUpperCase()}`
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
    const pkCol = this.getPkColumn(entityName);
    const pkProp = this.kir?.entities[entityName]?.key ?? "id";

    const data: Record<string, unknown> = { ...record };
    if (!data[pkProp] && !data[pkCol] && !data.id) {
      data[pkProp] = randomUUID();
    }

    const tenantCol = this.getTenantColumn();
    if (tenantCol && options?.tenantId && !data[tenantCol] && !data.tenantId) {
      data[tenantCol] = options.tenantId;
    }

    if (data.version === undefined) {
      data.version = 1;
    }

    if (options?.actor?.id) {
      data.createdBy = options.actor.id;
      data.updatedBy = options.actor.id;
    }

    this.ensureTable(entityName, data);

    const tableName = toSnakeCase(entityName);
    const cols: string[] = [];
    const placeholders: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const values: any[] = [];

    for (const [k, v] of Object.entries(data)) {
      const colName = toSnakeCase(k);
      cols.push(`"${colName}"`);
      placeholders.push("?");
      values.push(this.serializeValue(v));
    }

    const sql = `INSERT INTO "${tableName}" (${cols.join(", ")}) VALUES (${placeholders.join(", ")})`;
    const stmt = this.db.prepare(sql);
    stmt.run(...values);

    const id = (data[pkProp] ?? data[pkCol] ?? data.id) as string | number;

    const created = await this.get<T>(entityName, id, {
      tenantId: options?.tenantId,
      includeSoftDeleted: true,
    });
    return created!;
  }

  async update<T = Record<string, unknown>>(
    entityName: string,
    id: string | number,
    patch: Record<string, unknown>,
    options?: { tenantId?: string; actor?: { id?: string }; expectedVersion?: number }
  ): Promise<T> {
    const tableName = toSnakeCase(entityName);
    const pkCol = this.getPkColumn(entityName);
    const tenantCol = this.getTenantColumn();

    const existing = await this.get<Record<string, unknown>>(entityName, id, {
      tenantId: options?.tenantId,
      includeSoftDeleted: true,
    });
    if (!existing) {
      throw new Error(`Record ${entityName} with id ${id} not found`);
    }

    if (options?.expectedVersion !== undefined) {
      const currentVersion = (existing.version as number | undefined) ?? 1;
      if (currentVersion !== options.expectedVersion) {
        throw new VersionConflictError(entityName, String(id), options.expectedVersion, currentVersion);
      }
    }

    const sets: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const values: any[] = [];

    // Ensure columns exist for patch keys
    const existingCols = (this.db.prepare(`PRAGMA table_info("${tableName}")`).all() as { name: string }[]).map(
      (c) => c.name
    );
    for (const [k, v] of Object.entries(patch)) {
      const col = toSnakeCase(k);
      if (!existingCols.includes(col)) {
        let colType = "TEXT";
        if (typeof v === "number") colType = Number.isInteger(v) ? "INTEGER" : "REAL";
        if (typeof v === "boolean") colType = "INTEGER";
        this.db.exec(`ALTER TABLE "${tableName}" ADD COLUMN "${col}" ${colType};`);
        existingCols.push(col);
      }
    }

    for (const [k, v] of Object.entries(patch)) {
      const colName = toSnakeCase(k);
      if (colName === pkCol) continue;
      sets.push(`"${colName}" = ?`);
      values.push(this.serializeValue(v));
    }

    if (this.hasColumn(tableName, "updated_at")) {
      sets.push(`"updated_at" = datetime('now')`);
    }
    if (options?.actor?.id && this.hasColumn(tableName, "updated_by")) {
      sets.push(`"updated_by" = ?`);
      values.push(options.actor.id);
    }

    if (this.hasColumn(tableName, "version")) {
      const nextVersion = ((existing.version as number | undefined) ?? 1) + 1;
      sets.push(`"version" = ?`);
      values.push(nextVersion);
    }

    let sql = `UPDATE "${tableName}" SET ${sets.join(", ")} WHERE "${pkCol}" = ?`;
    values.push(id);

    if (tenantCol && options?.tenantId && this.hasColumn(tableName, tenantCol)) {
      sql += ` AND "${tenantCol}" = ?`;
      values.push(options.tenantId);
    }

    const stmt = this.db.prepare(sql);
    stmt.run(...values);

    const updated = await this.get<T>(entityName, id, {
      tenantId: options?.tenantId,
      includeSoftDeleted: true,
    });
    return updated!;
  }

  async delete(
    entityName: string,
    id: string | number,
    options?: { tenantId?: string; soft?: boolean; actor?: { id?: string } }
  ): Promise<boolean> {
    const tableName = toSnakeCase(entityName);
    if (!this.tableExists(tableName)) return false;

    const pkCol = this.getPkColumn(entityName);
    const tenantCol = this.getTenantColumn();

    if (options?.soft) {
      if (!this.hasColumn(tableName, "deleted")) {
        this.db.exec(`ALTER TABLE "${tableName}" ADD COLUMN "deleted" INTEGER DEFAULT 0;`);
      }
      if (!this.hasColumn(tableName, "deleted_at")) {
        this.db.exec(`ALTER TABLE "${tableName}" ADD COLUMN "deleted_at" TEXT;`);
      }

      const sets = [`"deleted" = 1`, `"deleted_at" = datetime('now')`];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const params: any[] = [];
      if (options.actor?.id && this.hasColumn(tableName, "updated_by")) {
        sets.push(`"updated_by" = ?`);
        params.push(options.actor.id);
      }
      params.push(id);

      let sql = `UPDATE "${tableName}" SET ${sets.join(", ")} WHERE "${pkCol}" = ?`;
      if (tenantCol && options.tenantId && this.hasColumn(tableName, tenantCol)) {
        sql += ` AND "${tenantCol}" = ?`;
        params.push(options.tenantId);
      }

      const stmt = this.db.prepare(sql);
      stmt.run(...params);
      return true;
    }

    let sql = `DELETE FROM "${tableName}" WHERE "${pkCol}" = ?`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any[] = [id];

    if (tenantCol && options?.tenantId && this.hasColumn(tableName, tenantCol)) {
      sql += ` AND "${tenantCol}" = ?`;
      params.push(options.tenantId);
    }

    const stmt = this.db.prepare(sql);
    stmt.run(...params);
    return true;
  }

  async transaction<R>(fn: (txStore: StorePort) => Promise<R>): Promise<R> {
    if (this.inTransaction) {
      return fn(this);
    }
    this.inTransaction = true;
    this.db.exec("BEGIN TRANSACTION;");
    try {
      const res = await fn(this);
      this.db.exec("COMMIT;");
      return res;
    } catch (err) {
      this.db.exec("ROLLBACK;");
      throw err;
    } finally {
      this.inTransaction = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Outbox Operations (ADR-0023 / PLAN.md §8.1)
  // ---------------------------------------------------------------------------

  async enqueueOutbox(message: OutboxMessage): Promise<void> {
    const stmt = this.db.prepare(
      `INSERT INTO _outbox (id, event_type, payload, aggregate_id, aggregate_type, tenant_id, created_at, dispatched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const createdAt = message.createdAt ?? new Date().toISOString();
    const payloadStr = typeof message.payload === "string" ? message.payload : JSON.stringify(message.payload);
    stmt.run(
      message.id,
      message.eventType,
      payloadStr,
      message.aggregateId ?? null,
      message.aggregateType ?? null,
      message.tenantId ?? null,
      createdAt,
      message.dispatchedAt ?? null
    );
  }

  async fetchPendingOutbox(limit = 100): Promise<OutboxMessage[]> {
    const stmt = this.db.prepare(
      `SELECT * FROM _outbox WHERE dispatched_at IS NULL ORDER BY created_at ASC LIMIT ?`
    );
    const rows = stmt.all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      eventType: r.event_type as string,
      payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
      aggregateId: (r.aggregate_id as string) ?? undefined,
      aggregateType: (r.aggregate_type as string) ?? undefined,
      tenantId: (r.tenant_id as string) ?? undefined,
      createdAt: r.created_at as string,
      dispatchedAt: (r.dispatched_at as string) ?? undefined,
    }));
  }

  async markOutboxDispatched(id: string): Promise<void> {
    const stmt = this.db.prepare(`UPDATE _outbox SET dispatched_at = datetime('now') WHERE id = ?`);
    stmt.run(id);
  }

  // ---------------------------------------------------------------------------
  // Timer Operations (ADR-0015 / PLAN.md §8.1)
  // ---------------------------------------------------------------------------

  async enqueueTimer(entry: TimerEntry): Promise<void> {
    const stmt = this.db.prepare(
      `INSERT INTO _timers (id, target, payload, trigger_at, dispatched_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    const payloadStr = entry.payload
      ? typeof entry.payload === "string"
        ? entry.payload
        : JSON.stringify(entry.payload)
      : null;
    stmt.run(entry.id, entry.target, payloadStr, entry.triggerAt, entry.dispatchedAt ?? null);
  }

  async fetchDueTimers(now: string, limit = 100): Promise<TimerEntry[]> {
    const stmt = this.db.prepare(
      `SELECT * FROM _timers WHERE dispatched_at IS NULL AND trigger_at <= ? ORDER BY trigger_at ASC LIMIT ?`
    );
    const rows = stmt.all(now, limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      target: r.target as string,
      payload: r.payload ? (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) : undefined,
      triggerAt: r.trigger_at as string,
      dispatchedAt: (r.dispatched_at as string) ?? undefined,
    }));
  }

  async markTimerDispatched(id: string): Promise<void> {
    const stmt = this.db.prepare(`UPDATE _timers SET dispatched_at = datetime('now') WHERE id = ?`);
    stmt.run(id);
  }

  // ---------------------------------------------------------------------------
  // Internal Helpers
  // ---------------------------------------------------------------------------

  private tableExists(tableName: string): boolean {
    const row = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
      .get(tableName);
    return Boolean(row);
  }

  private hasColumn(tableName: string, colName: string): boolean {
    try {
      const cols = this.db.prepare(`PRAGMA table_info("${tableName}")`).all() as { name: string }[];
      return cols.some((c) => c.name === colName);
    } catch {
      return false;
    }
  }

  private ensureTable(entityName: string, record: Record<string, unknown>): void {
    const tableName = toSnakeCase(entityName);
    const pkCol = this.getPkColumn(entityName);

    if (!this.tableExists(tableName)) {
      const colDefs: string[] = [`"${pkCol}" TEXT PRIMARY KEY`];
      for (const [k, v] of Object.entries(record)) {
        const col = toSnakeCase(k);
        if (col === pkCol) continue;
        let colType = "TEXT";
        if (typeof v === "number") colType = Number.isInteger(v) ? "INTEGER" : "REAL";
        if (typeof v === "boolean") colType = "INTEGER";
        colDefs.push(`"${col}" ${colType}`);
      }
      if (!record.tenantId && !record.tenant_id) colDefs.push(`"tenant_id" TEXT`);
      if (!record.deleted) colDefs.push(`"deleted" INTEGER DEFAULT 0`);
      if (!record.deleted_at) colDefs.push(`"deleted_at" TEXT`);
      if (!record.created_at) colDefs.push(`"created_at" TEXT DEFAULT (datetime('now'))`);
      if (!record.updated_at) colDefs.push(`"updated_at" TEXT DEFAULT (datetime('now'))`);
      if (!record.version) colDefs.push(`"version" INTEGER DEFAULT 1`);

      this.db.exec(`CREATE TABLE IF NOT EXISTS "${tableName}" (${colDefs.join(", ")});`);
    } else {
      const existingCols = (this.db.prepare(`PRAGMA table_info("${tableName}")`).all() as { name: string }[]).map(
        (c) => c.name
      );
      for (const [k, v] of Object.entries(record)) {
        const col = toSnakeCase(k);
        if (!existingCols.includes(col)) {
          let colType = "TEXT";
          if (typeof v === "number") colType = Number.isInteger(v) ? "INTEGER" : "REAL";
          if (typeof v === "boolean") colType = "INTEGER";
          this.db.exec(`ALTER TABLE "${tableName}" ADD COLUMN "${col}" ${colType};`);
          existingCols.push(col);
        }
      }
      if (!existingCols.includes("deleted")) {
        this.db.exec(`ALTER TABLE "${tableName}" ADD COLUMN "deleted" INTEGER DEFAULT 0;`);
      }
      if (!existingCols.includes("deleted_at")) {
        this.db.exec(`ALTER TABLE "${tableName}" ADD COLUMN "deleted_at" TEXT;`);
      }
      if (!existingCols.includes("version")) {
        this.db.exec(`ALTER TABLE "${tableName}" ADD COLUMN "version" INTEGER DEFAULT 1;`);
      }
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
    return "tenant_id";
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
