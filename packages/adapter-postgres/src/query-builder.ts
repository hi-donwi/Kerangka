/**
 * Kerangka PostgreSQL Query Builder
 * Specification Version: 0.2
 * Status: Draft
 * License: Apache-2.0
 */

import { KIRDocument, toSnakeCase } from "@kerangka/compiler";
import { OutboxMessage, QueryFilter, QueryOptions, TimerEntry } from "@kerangka/ports";

export interface ParameterizedQuery {
  sql: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  values: any[];
}

export class PostgresQueryBuilder {
  private readonly kir?: KIRDocument;

  constructor(kir?: KIRDocument) {
    this.kir = kir;
  }

  buildGet(
    entityName: string,
    id: string | number,
    options?: { tenantId?: string; includeSoftDeleted?: boolean }
  ): ParameterizedQuery {
    const tableName = toSnakeCase(entityName);
    const pkCol = this.getPkColumn(entityName);
    const tenantCol = this.getTenantColumn();
    const entity = this.kir?.entities[entityName];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const values: any[] = [id];
    let paramIndex = 1;
    let sql = `SELECT * FROM ${tableName} WHERE ${pkCol} = $${paramIndex++}`;

    if (tenantCol && options?.tenantId) {
      values.push(options.tenantId);
      sql += ` AND ${tenantCol} = $${paramIndex++}`;
    }

    if (!options?.includeSoftDeleted && entity?.fields && "deleted" in entity.fields) {
      sql += ` AND (deleted = FALSE OR deleted IS NULL)`;
    }

    return { sql, values };
  }

  buildFind(
    entityName: string,
    filter?: QueryFilter,
    options?: QueryOptions
  ): { dataQuery: ParameterizedQuery; countQuery: ParameterizedQuery } {
    const tableName = toSnakeCase(entityName);
    const tenantCol = this.getTenantColumn();
    const entity = this.kir?.entities[entityName];

    const whereClauses: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const values: any[] = [];
    let paramIndex = 1;

    if (tenantCol && options?.tenantId) {
      whereClauses.push(`${tenantCol} = $${paramIndex++}`);
      values.push(options.tenantId);
    }

    if (!options?.includeSoftDeleted && entity?.fields && "deleted" in entity.fields) {
      whereClauses.push(`(deleted = FALSE OR deleted IS NULL)`);
    }

    if (filter) {
      for (const [k, v] of Object.entries(filter)) {
        whereClauses.push(`${toSnakeCase(k)} = $${paramIndex++}`);
        values.push(v);
      }
    }

    const whereSql = whereClauses.length > 0 ? ` WHERE ${whereClauses.join(" AND ")}` : "";
    const countSql = `SELECT COUNT(*) as count FROM ${tableName}${whereSql}`;
    const countValues = [...values];

    let sql = `SELECT * FROM ${tableName}${whereSql}`;

    if (options?.sort) {
      const orderClauses = Object.entries(options.sort).map(
        ([col, dir]) => `${toSnakeCase(col)} ${(dir as string).toUpperCase()}`
      );
      sql += ` ORDER BY ${orderClauses.join(", ")}`;
    }

    if (options?.limit !== undefined) {
      sql += ` LIMIT $${paramIndex++}`;
      values.push(options.limit);
      if (options.offset !== undefined) {
        sql += ` OFFSET $${paramIndex++}`;
        values.push(options.offset);
      }
    }

    return {
      dataQuery: { sql, values },
      countQuery: { sql: countSql, values: countValues },
    };
  }

  buildInsert(
    entityName: string,
    record: Record<string, unknown>,
    options?: { tenantId?: string; actor?: { id?: string } }
  ): ParameterizedQuery {
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
    let paramIndex = 1;

    for (const [k, v] of Object.entries(data)) {
      const colName = toSnakeCase(k);
      cols.push(colName);
      placeholders.push(`$${paramIndex++}`);
      values.push(this.serializeValue(entityName, k, v));
    }

    const sql = `INSERT INTO ${tableName} (${cols.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`;
    return { sql, values };
  }

  buildUpdate(
    entityName: string,
    id: string | number,
    patch: Record<string, unknown>,
    options?: { tenantId?: string; actor?: { id?: string }; expectedVersion?: number }
  ): ParameterizedQuery {
    const tableName = toSnakeCase(entityName);
    const pkCol = this.getPkColumn(entityName);
    const tenantCol = this.getTenantColumn();

    const sets: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const values: any[] = [];
    let paramIndex = 1;

    for (const [k, v] of Object.entries(patch)) {
      const colName = toSnakeCase(k);
      if (colName === pkCol) continue;
      sets.push(`${colName} = $${paramIndex++}`);
      values.push(this.serializeValue(entityName, k, v));
    }

    sets.push(`updated_at = CURRENT_TIMESTAMP`);
    if (options?.actor?.id) {
      sets.push(`updated_by = $${paramIndex++}`);
      values.push(options.actor.id);
    }

    if (options?.expectedVersion !== undefined) {
      sets.push(`version = version + 1`);
    }

    const idParam = `$${paramIndex++}`;
    values.push(id);

    let sql = `UPDATE ${tableName} SET ${sets.join(", ")} WHERE ${pkCol} = ${idParam}`;

    if (tenantCol && options?.tenantId) {
      const tenantParam = `$${paramIndex++}`;
      values.push(options.tenantId);
      sql += ` AND ${tenantCol} = ${tenantParam}`;
    }

    if (options?.expectedVersion !== undefined) {
      const versionParam = `$${paramIndex++}`;
      values.push(options.expectedVersion);
      sql += ` AND version = ${versionParam}`;
    }

    sql += ` RETURNING *`;
    return { sql, values };
  }

  buildDelete(
    entityName: string,
    id: string | number,
    options?: { tenantId?: string; soft?: boolean; actor?: { id?: string } }
  ): ParameterizedQuery {
    const tableName = toSnakeCase(entityName);
    const pkCol = this.getPkColumn(entityName);
    const tenantCol = this.getTenantColumn();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const values: any[] = [];
    let paramIndex = 1;

    if (options?.soft) {
      const sets = ["deleted = TRUE", "deleted_at = CURRENT_TIMESTAMP"];
      if (options.actor?.id) {
        sets.push(`updated_by = $${paramIndex++}`);
        values.push(options.actor.id);
      }
      const idParam = `$${paramIndex++}`;
      values.push(id);

      let sql = `UPDATE ${tableName} SET ${sets.join(", ")} WHERE ${pkCol} = ${idParam}`;
      if (tenantCol && options?.tenantId) {
        const tenantParam = `$${paramIndex++}`;
        values.push(options.tenantId);
        sql += ` AND ${tenantCol} = ${tenantParam}`;
      }
      return { sql, values };
    }

    values.push(id);
    let sql = `DELETE FROM ${tableName} WHERE ${pkCol} = $1`;

    if (tenantCol && options?.tenantId) {
      values.push(options.tenantId);
      sql += ` AND ${tenantCol} = $2`;
    }

    return { sql, values };
  }

  // ---------------------------------------------------------------------------
  // Outbox Queries (ADR-0023 / PLAN.md §8.1)
  // ---------------------------------------------------------------------------

  buildEnqueueOutbox(message: OutboxMessage): ParameterizedQuery {
    const createdAt = message.createdAt ?? new Date().toISOString();
    const payloadStr = typeof message.payload === "string" ? message.payload : JSON.stringify(message.payload);
    return {
      sql: `INSERT INTO _outbox (id, event_type, payload, aggregate_id, aggregate_type, tenant_id, created_at, dispatched_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      values: [
        message.id,
        message.eventType,
        payloadStr,
        message.aggregateId ?? null,
        message.aggregateType ?? null,
        message.tenantId ?? null,
        createdAt,
        message.dispatchedAt ?? null,
      ],
    };
  }

  buildFetchPendingOutbox(limit = 100): ParameterizedQuery {
    return {
      sql: `SELECT * FROM _outbox WHERE dispatched_at IS NULL ORDER BY created_at ASC LIMIT $1`,
      values: [limit],
    };
  }

  buildMarkOutboxDispatched(id: string): ParameterizedQuery {
    return {
      sql: `UPDATE _outbox SET dispatched_at = CURRENT_TIMESTAMP WHERE id = $1`,
      values: [id],
    };
  }

  // ---------------------------------------------------------------------------
  // Timers Queries (ADR-0015 / PLAN.md §8.1)
  // ---------------------------------------------------------------------------

  buildEnqueueTimer(entry: TimerEntry): ParameterizedQuery {
    const payloadStr = entry.payload
      ? typeof entry.payload === "string"
        ? entry.payload
        : JSON.stringify(entry.payload)
      : null;
    return {
      sql: `INSERT INTO _timers (id, target, payload, trigger_at, dispatched_at) VALUES ($1, $2, $3, $4, $5)`,
      values: [entry.id, entry.target, payloadStr, entry.triggerAt, entry.dispatchedAt ?? null],
    };
  }

  buildFetchDueTimers(now: string, limit = 100): ParameterizedQuery {
    return {
      sql: `SELECT * FROM _timers WHERE dispatched_at IS NULL AND trigger_at <= $1 ORDER BY trigger_at ASC LIMIT $2`,
      values: [now, limit],
    };
  }

  buildMarkTimerDispatched(id: string): ParameterizedQuery {
    return {
      sql: `UPDATE _timers SET dispatched_at = CURRENT_TIMESTAMP WHERE id = $1`,
      values: [id],
    };
  }

  // ---------------------------------------------------------------------------
  // Internal Helpers
  // ---------------------------------------------------------------------------

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

  private serializeValue(entityName: string, fieldProp: string, val: unknown): unknown {
    if (val === null || val === undefined) return null;
    const fieldDef = this.kir?.entities[entityName]?.fields[fieldProp];
    if (fieldDef?.type === "list" || typeof val === "object") {
      return JSON.stringify(val);
    }
    return val;
  }
}
