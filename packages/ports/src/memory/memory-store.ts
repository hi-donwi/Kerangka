/**
 * Kerangka In-Memory Store Adapter for fast hermetic testing
 * Specification Version: 0.2
 * Status: Draft
 * License: Apache-2.0
 */

import {
  OutboxMessage,
  QueryFilter,
  QueryOptions,
  QueryResult,
  StorePort,
  TimerEntry,
  VersionConflictError,
} from "../store.js";

export class MemoryStore implements StorePort {
  // entityName -> id -> record
  private data: Map<string, Map<string | number, Record<string, unknown>>>;
  private outbox: OutboxMessage[] = [];
  private timers: TimerEntry[] = [];

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

    // Soft delete filtering
    if (!options?.includeSoftDeleted) {
      items = items.filter((i) => i.deleted !== true);
    }

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
    if (data.version === undefined && record.version !== undefined) {
      data.version = Number(record.version);
    }

    table.set(id, data);
    return structuredClone(data) as T;
  }

  async update<T = Record<string, unknown>>(
    entityName: string,
    id: string | number,
    patch: Record<string, unknown>,
    options?: { tenantId?: string; actor?: { id?: string }; expectedVersion?: number }
  ): Promise<T> {
    const existing = await this.get<Record<string, unknown>>(entityName, id, options);
    if (!existing) {
      throw new Error(`Record not found in ${entityName} with id '${id}'`);
    }

    if (options?.expectedVersion !== undefined) {
      const currentVersion = Number(existing.version ?? 0);
      if (currentVersion !== options.expectedVersion) {
        throw new VersionConflictError(
          `Record '${entityName}:${id}' version conflict: expected version ${options.expectedVersion}, got ${currentVersion}`
        );
      }
    }

    const updated: Record<string, unknown> = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
      ...(options?.actor?.id ? { updatedBy: options.actor.id } : {}),
    };

    if (existing.version !== undefined) {
      updated.version = patch.version !== undefined ? Number(patch.version) : Number(existing.version) + 1;
    }

    this.data.get(entityName)!.set(String(id), updated);
    return structuredClone(updated) as T;
  }

  async delete(
    entityName: string,
    id: string | number,
    options?: { tenantId?: string; soft?: boolean; actor?: { id?: string } }
  ): Promise<boolean> {
    const existing = await this.get(entityName, id, options);
    if (!existing) return false;

    if (options?.soft) {
      const updated = {
        ...existing,
        deleted: true,
        deletedAt: new Date().toISOString(),
        ...(options?.actor?.id ? { updatedBy: options.actor.id } : {}),
      };
      this.data.get(entityName)!.set(String(id), updated);
      return true;
    }

    this.data.get(entityName)!.delete(String(id));
    return true;
  }

  async transaction<R>(fn: (txStore: StorePort) => Promise<R>): Promise<R> {
    const dataClone = new Map<string, Map<string | number, Record<string, unknown>>>();
    for (const [k, v] of this.data.entries()) {
      dataClone.set(k, new Map(v.entries()));
    }
    const outboxClone = this.outbox.map((o) => ({ ...o }));
    const timersClone = this.timers.map((t) => ({ ...t }));

    try {
      return await fn(this);
    } catch (err) {
      this.data = dataClone;
      this.outbox = outboxClone;
      this.timers = timersClone;
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Transactional Outbox (ADR-0023 / PLAN.md §8.1)
  // ---------------------------------------------------------------------------

  async enqueueOutbox(message: OutboxMessage): Promise<void> {
    this.outbox.push({
      ...message,
      createdAt: message.createdAt ?? new Date().toISOString(),
    });
  }

  async fetchPendingOutbox(limit = 100): Promise<OutboxMessage[]> {
    return this.outbox
      .filter((m) => !m.dispatchedAt)
      .slice(0, limit)
      .map((m) => structuredClone(m));
  }

  async markOutboxDispatched(id: string): Promise<void> {
    const msg = this.outbox.find((m) => m.id === id);
    if (msg) {
      msg.dispatchedAt = new Date().toISOString();
    }
  }

  // ---------------------------------------------------------------------------
  // Database Timer Table (ADR-0015 / PLAN.md §8.1)
  // ---------------------------------------------------------------------------

  async enqueueTimer(entry: TimerEntry): Promise<void> {
    this.timers.push({
      ...entry,
    });
  }

  async fetchDueTimers(now?: string | Date, limit = 100): Promise<TimerEntry[]> {
    const nowMs = now ? new Date(now).getTime() : Date.now();
    return this.timers
      .filter((t) => !t.dispatchedAt && new Date(t.triggerAt).getTime() <= nowMs)
      .slice(0, limit)
      .map((t) => structuredClone(t));
  }

  async markTimerDispatched(id: string): Promise<void> {
    const entry = this.timers.find((t) => t.id === id);
    if (entry) {
      entry.dispatchedAt = new Date().toISOString();
    }
  }
}
