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

function readPath(record: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (value === null || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[key];
  }, record);
}

function compareValues(left: unknown, right: unknown): number {
  if (left === right) return 0;
  if (left === undefined || left === null) return -1;
  if (right === undefined || right === null) return 1;
  return left > right ? 1 : -1;
}

function predicateValue(node: unknown, record: Record<string, unknown>): unknown {
  if (Array.isArray(node)) {
    if (node[0] === "get" && typeof node[1] === "string") return readPath(record, node[1]);
    if (node[0] === "literal") return node[1];
  }
  return node;
}

function matchesPredicate(node: unknown, record: Record<string, unknown>): boolean {
  if (!Array.isArray(node) || node.length === 0) return true;
  const [operator, ...args] = node;
  if (operator === "and") return args.every((branch) => matchesPredicate(branch, record));
  if (operator === "or") return args.some((branch) => matchesPredicate(branch, record));
  if (operator === "not") return !matchesPredicate(args[0], record);

  const left = predicateValue(args[0], record);
  const right = predicateValue(args[1], record);
  switch (operator) {
    case "==": return left === right || (left !== undefined && right !== undefined && String(left) === String(right));
    case "!=": return left !== right && String(left) !== String(right);
    case "<": return compareValues(left, right) < 0;
    case "<=": return compareValues(left, right) <= 0;
    case ">": return compareValues(left, right) > 0;
    case ">=": return compareValues(left, right) >= 0;
    case "in": return Array.isArray(right) && right.some((value) => String(value) === String(left));
    case "between": return Array.isArray(right) && right.length === 2 && compareValues(left, right[0]) >= 0 && compareValues(left, right[1]) <= 0;
    case "like": return String(left ?? "").toLowerCase().includes(String(right ?? "").toLowerCase());
    default: return true;
  }
}

function indexKey(value: unknown): string {
  return `${typeof value}:${JSON.stringify(value)}`;
}

function equalityPredicates(node: unknown): Array<[string, unknown]> {
  if (!Array.isArray(node) || node.length === 0) return [];
  const [operator, ...args] = node;
  if (operator === "and") return args.flatMap(equalityPredicates);
  if (operator !== "==" || !Array.isArray(args[0]) || args[0][0] !== "get" || typeof args[0][1] !== "string") return [];
  const value = args[1];
  if (Array.isArray(value) || value === undefined) return [];
  return [[args[0][1], value]];
}

export class MemoryStore implements StorePort {
  // entityName -> id -> record
  private data: Map<string, Map<string | number, Record<string, unknown>>>;
  private indexes = new Map<string, Map<string, Map<string, Set<string | number>>>>();
  private outbox: OutboxMessage[] = [];
  private timers: TimerEntry[] = [];

  constructor(initialData?: Map<string, Map<string | number, Record<string, unknown>>>) {
    this.data = initialData ?? new Map();
    for (const entityName of this.data.keys()) this.rebuildIndexes(entityName);
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

    const constraints: Array<[string, unknown]> = [];
    if (options?.tenantId) constraints.push(["tenantId", options.tenantId]);
    if (filter) constraints.push(...Object.entries(filter));
    constraints.push(...equalityPredicates(options?.where));

    let candidateIds: Set<string | number> | undefined;
    for (const [field, value] of constraints) {
      const fieldIndex = this.indexes.get(entityName)?.get(field);
      const ids = fieldIndex?.get(indexKey(value));
      if (!ids) {
        candidateIds = new Set();
        break;
      }
      if (!candidateIds) candidateIds = new Set(ids);
      else candidateIds = new Set([...candidateIds].filter((id) => ids.has(id)));
    }

    let items = candidateIds
      ? [...candidateIds].map((id) => table.get(id)).filter((item): item is Record<string, unknown> => Boolean(item))
      : Array.from(table.values());

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

    if (options?.where !== undefined) {
      items = items.filter((item) => matchesPredicate(options.where, item));
    }

    const search = options?.search?.trim().toLowerCase();
    if (search) {
      items = items.filter((item) => Object.values(item).some((value) =>
        value !== null && value !== undefined && String(value).toLowerCase().includes(search),
      ));
    }

    const total = items.length;

    if (options?.sort) {
      const clauses = Object.entries(options.sort);
      items.sort((a, b) => {
        for (const [sortField, sortDir] of clauses) {
          const valA = readPath(a, sortField);
          const valB = readPath(b, sortField);
          if (valA === valB) continue;
          const cmp = compareValues(valA, valB);
          return sortDir === "desc" ? -cmp : cmp;
        }
        return 0;
      });
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
    this.rebuildIndexes(entityName);
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
    this.rebuildIndexes(entityName);
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
      this.rebuildIndexes(entityName);
      return true;
    }

    this.data.get(entityName)!.delete(String(id));
    this.rebuildIndexes(entityName);
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
      for (const entityName of this.data.keys()) this.rebuildIndexes(entityName);
      this.outbox = outboxClone;
      this.timers = timersClone;
      throw err;
    }
  }

  private rebuildIndexes(entityName: string): void {
    const table = this.data.get(entityName);
    if (!table) {
      this.indexes.delete(entityName);
      return;
    }
    const fields = new Map<string, Map<string, Set<string | number>>>();
    for (const [id, record] of table.entries()) {
      for (const [field, value] of Object.entries(record)) {
        if (value === undefined || value === null || typeof value === "object") continue;
        let values = fields.get(field);
        if (!values) {
          values = new Map();
          fields.set(field, values);
        }
        let ids = values.get(indexKey(value));
        if (!ids) {
          ids = new Set();
          values.set(indexKey(value), ids);
        }
        ids.add(id);
      }
    }
    this.indexes.set(entityName, fields);
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
