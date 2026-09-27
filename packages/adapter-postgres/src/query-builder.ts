/**
 * Kerangka PostgreSQL Query Builder
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import { KIRDocument, toSnakeCase } from "@kerangka/compiler";
import { QueryFilter, QueryOptions } from "@kerangka/ports";

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
    options?: { tenantId?: string }
  ): ParameterizedQuery {
    const tableName = toSnakeCase(entityName);
    const pkCol = this.getPkColumn(entityName);
    const tenantCol = this.getTenantColumn();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const values: any[] = [id];
    let sql = `SELECT * FROM ${tableName} WHERE ${pkCol} = $1`;

    if (tenantCol && options?.tenantId) {
      values.push(options.tenantId);
      sql += ` AND ${tenantCol} = $2`;
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

    const whereClauses: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const values: any[] = [];
    let paramIndex = 1;

    if (tenantCol && options?.tenantId) {
      whereClauses.push(`${tenantCol} = $${paramIndex++}`);
      values.push(options.tenantId);
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
    options?: { tenantId?: string; actor?: { id?: string } }
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

    const idParam = `$${paramIndex++}`;
    values.push(id);

    let sql = `UPDATE ${tableName} SET ${sets.join(", ")} WHERE ${pkCol} = ${idParam}`;

    if (tenantCol && options?.tenantId) {
      const tenantParam = `$${paramIndex++}`;
      values.push(options.tenantId);
      sql += ` AND ${tenantCol} = ${tenantParam}`;
    }

    sql += ` RETURNING *`;
    return { sql, values };
  }

  buildDelete(
    entityName: string,
    id: string | number,
    options?: { tenantId?: string }
  ): ParameterizedQuery {
    const tableName = toSnakeCase(entityName);
    const pkCol = this.getPkColumn(entityName);
    const tenantCol = this.getTenantColumn();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const values: any[] = [id];
    let sql = `DELETE FROM ${tableName} WHERE ${pkCol} = $1`;

    if (tenantCol && options?.tenantId) {
      values.push(options.tenantId);
      sql += ` AND ${tenantCol} = $2`;
    }

    return { sql, values };
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

  private serializeValue(entityName: string, fieldProp: string, val: unknown): unknown {
    if (val === null || val === undefined) return null;
    const fieldDef = this.kir?.entities[entityName]?.fields[fieldProp];
    if (fieldDef?.type === "list" || typeof val === "object") {
      return JSON.stringify(val);
    }
    return val;
  }
}
