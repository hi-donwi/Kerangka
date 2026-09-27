/**
 * Kerangka In-Memory Store Adapter for fast hermetic testing
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import { QueryFilter, QueryOptions, QueryResult, StorePort } from "../store.js";

export class MemoryStore implements StorePort {
  // entityName -> id -> record
  private data: Map<string, Map<string | number, Record<string, unknown>>>;

  constructor(initialData?: Map<string, Map<string | number, Record<string, unknown>>>) {
    this.data = initialData ?? new Map();
  }

  async get<T = Record<string, unknown>>(
    entityName: string,
    id: string | number,
    options?: { tenantId?: string }
  ): Promise<T | null> {
    const table = this.data.get(entityName);
    if (!table) return null;
    const item = table.get(String(id));
    if (!item) return null;

    if (options?.tenantId && item.tenantId && item.tenantId !== options.tenantId) {
      return null;
    }

    return structuredClone(item) as T;
  }

  async find<T = Record<string, unknown>>(
    entityName: string,
    filter?: QueryFilter,
    options?: QueryOptions
  ): Promise<QueryResult<T>> {
    const table = this.data.get(entityName);
    if (!table) {
      return { items: [], total: 0, limit: options?.limit, offset: options?.offset };
    }

    let items = Array.from(table.values());

    if (options?.tenantId) {
      items = items.filter((i) => i.tenantId === options.tenantId);
    }

    if (filter) {
      items = items.filter((item) => {
        for (const [k, v] of Object.entries(filter)) {
          if (item[k] !== v) return false;
        }
        return true;
      });
    }

    const total = items.length;

    if (options?.sort) {
      const [sortField, sortDir] = Object.entries(options.sort)[0] ?? [];
      if (sortField) {
        items.sort((a, b) => {
          const valA = a[sortField];
          const valB = b[sortField];
          if (valA === valB) return 0;
          const cmp = valA! > valB! ? 1 : -1;
          return sortDir === "desc" ? -cmp : cmp;
        });
      }
    }

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? items.length;
    items = items.slice(offset, offset + limit);

    return {
      items: items.map((i) => structuredClone(i) as T),
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
    if (!this.data.has(entityName)) {
      this.data.set(entityName, new Map());
    }
    const table = this.data.get(entityName)!;

    const data: Record<string, unknown> = structuredClone(record);
    const id = String(data.id ?? data.sku ?? data.number ?? table.size + 1);
    data.id = id;

    if (options?.tenantId) {
      data.tenantId = options.tenantId;
    }
    data.createdAt = new Date().toISOString();
    data.updatedAt = new Date().toISOString();
    if (options?.actor?.id) {
      data.createdBy = options.actor.id;
      data.updatedBy = options.actor.id;
    }

    table.set(id, data);
    return structuredClone(data) as T;
  }

  async update<T = Record<string, unknown>>(
    entityName: string,
    id: string | number,
    patch: Record<string, unknown>,
    options?: { tenantId?: string; actor?: { id?: string } }
  ): Promise<T> {
    const existing = await this.get<Record<string, unknown>>(entityName, id, options);
    if (!existing) {
      throw new Error(`Record not found in ${entityName} with id '${id}'`);
    }

    const updated = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
      ...(options?.actor?.id ? { updatedBy: options.actor.id } : {}),
    };

    this.data.get(entityName)!.set(String(id), updated);
    return structuredClone(updated) as T;
  }

  async delete(
    entityName: string,
    id: string | number,
    options?: { tenantId?: string }
  ): Promise<boolean> {
    const existing = await this.get(entityName, id, options);
    if (!existing) return false;
    this.data.get(entityName)!.delete(String(id));
    return true;
  }

  async transaction<R>(fn: (txStore: StorePort) => Promise<R>): Promise<R> {
    // Deep clone data map for rollback
    const clone = new Map<string, Map<string | number, Record<string, unknown>>>();
    for (const [k, v] of this.data.entries()) {
      clone.set(k, new Map(v.entries()));
    }

    try {
      return await fn(this);
    } catch (err) {
      this.data = clone;
      throw err;
    }
  }
}
