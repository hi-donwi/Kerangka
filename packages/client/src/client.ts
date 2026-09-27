/**
 * Kerangka Offline-First Client Runtime
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import type { SyncStatus } from '@kerangka/ports';
import { OutboxQueue } from './outbox.js';
import type {
  ConflictPolicy,
  ConflictResolution,
  FlushResult,
  MutationAction,
  MutationActionType,
  SyncTransport,
  TransportResponse,
} from './types.js';

export interface ClientOptions {
  conflictPolicy?: ConflictPolicy;
  transport?: SyncTransport;
  initialOnline?: boolean;
}

export class KerangkaClient {
  readonly outbox: OutboxQueue;
  conflictPolicy: ConflictPolicy;
  transport?: SyncTransport;
  isOnline: boolean;
  private cache = new Map<string, Map<string, Record<string, unknown>>>();
  private lastSyncTime?: string;

  constructor(options: ClientOptions = {}) {
    this.outbox = new OutboxQueue();
    this.conflictPolicy = options.conflictPolicy ?? 'server-wins';
    this.transport = options.transport;
    this.isOnline = options.initialOnline ?? true;
  }

  /**
   * Retrieves a record from the local in-memory cache.
   */
  get<T = Record<string, unknown>>(entityName: string, id: string): T | null {
    const table = this.cache.get(entityName);
    if (!table) return null;
    const item = table.get(id);
    return item ? (JSON.parse(JSON.stringify(item)) as T) : null;
  }

  /**
   * Lists all local records for an entity.
   */
  list<T = Record<string, unknown>>(entityName: string): T[] {
    const table = this.cache.get(entityName);
    if (!table) return [];
    return Array.from(table.values()).map(
      (item) => JSON.parse(JSON.stringify(item)) as T
    );
  }

  /**
   * Manually sets or primes a record in the local cache.
   */
  setCache(entityName: string, id: string, record: Record<string, unknown>): void {
    let table = this.cache.get(entityName);
    if (!table) {
      table = new Map();
      this.cache.set(entityName, table);
    }
    table.set(id, JSON.parse(JSON.stringify(record)));
  }

  /**
   * Clears entity cache or all cache.
   */
  clearCache(entityName?: string): void {
    if (entityName) {
      this.cache.delete(entityName);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Mutates a record optimistically, enqueues the action in the outbox,
   * and attempts an immediate sync if online.
   */
  async mutate(params: {
    entity: string;
    type: MutationActionType;
    recordId: string;
    payload: Record<string, unknown>;
    transition?: string;
    optimistic?: boolean;
  }): Promise<MutationAction> {
    const { entity, type, recordId, payload, transition } = params;
    const optimistic = params.optimistic !== false;

    // Snapshot current state for rollback if needed
    const previousSnapshot = this.get(entity, recordId);

    if (optimistic) {
      this.applyLocalOptimistic(entity, type, recordId, payload, transition);
    }

    const action = this.outbox.enqueue({
      entity,
      type,
      recordId,
      payload,
      transition,
      previousSnapshot,
    });

    if (this.isOnline && this.transport) {
      await this.flush();
    }

    return action;
  }

  /**
   * Flushes and replays all pending outbox actions in FIFO order over the transport.
   */
  async flush(): Promise<FlushResult> {
    if (!this.transport) {
      return { syncedCount: 0, conflicts: [], failedCount: 0 };
    }

    const pending = this.outbox.peek('pending');
    let syncedCount = 0;
    let failedCount = 0;
    const conflicts: ConflictResolution[] = [];

    for (const action of pending) {
      this.outbox.update(action.id, { status: 'syncing' });

      let res: TransportResponse;
      try {
        res = await this.transport.send(action);
      } catch (err: any) {
        // Network/transient error: keep in outbox for future retry
        this.outbox.update(action.id, {
          status: 'pending',
          retryCount: action.retryCount + 1,
          error: err?.message || 'Network error',
        });
        failedCount += 1;
        break; // Stop replaying downstream dependent actions
      }

      if (res.ok) {
        this.outbox.remove(action.id);
        syncedCount += 1;

        // If server returned canonical record, update local cache
        if (res.serverRecord) {
          this.setCache(action.entity, action.recordId, res.serverRecord);
        }
      } else {
        // Conflict or validation failure from server
        const errMessage = res.error || `Server responded with status ${res.status}`;
        const resolution = this.resolveConflict(action, res, errMessage);
        conflicts.push(resolution);
        failedCount += 1;
      }
    }

    if (syncedCount > 0) {
      this.lastSyncTime = new Date().toISOString();
    }

    return { syncedCount, conflicts, failedCount };
  }

  /**
   * Reverts an action's optimistic change and restores the previous snapshot.
   */
  rollback(actionId: string): boolean {
    const action = this.outbox.get(actionId);
    if (!action) return false;

    this.revertLocalSnapshot(action.entity, action.recordId, action.previousSnapshot);
    this.outbox.remove(actionId);
    return true;
  }

  /**
   * Returns standard synchronization status.
   */
  getSyncStatus(): SyncStatus {
    return {
      lastSyncAt: this.lastSyncTime,
      pendingMutations: this.outbox.pendingCount,
      inConflict: this.outbox.inConflict,
    };
  }

  private applyLocalOptimistic(
    entity: string,
    type: MutationActionType,
    recordId: string,
    payload: Record<string, unknown>,
    _transition?: string
  ): void {
    let table = this.cache.get(entity);
    if (!table) {
      table = new Map();
      this.cache.set(entity, table);
    }

    if (type === 'create') {
      table.set(recordId, { id: recordId, ...payload });
    } else if (type === 'update' || type === 'transition') {
      const existing = table.get(recordId) || { id: recordId };
      table.set(recordId, { ...existing, ...payload });
    } else if (type === 'delete') {
      table.delete(recordId);
    }
  }

  private revertLocalSnapshot(
    entity: string,
    recordId: string,
    snapshot?: Record<string, unknown> | null
  ): void {
    let table = this.cache.get(entity);
    if (!table) {
      table = new Map();
      this.cache.set(entity, table);
    }

    if (snapshot) {
      table.set(recordId, snapshot);
    } else {
      table.delete(recordId);
    }
  }

  private resolveConflict(
    action: MutationAction,
    res: TransportResponse,
    error: string
  ): ConflictResolution {
    switch (this.conflictPolicy) {
      case 'server-wins': {
        // Roll back local optimistic state to server's true state or previous snapshot
        if (res.serverRecord) {
          this.setCache(action.entity, action.recordId, res.serverRecord);
        } else {
          this.revertLocalSnapshot(action.entity, action.recordId, action.previousSnapshot);
        }
        this.outbox.remove(action.id);
        return {
          action,
          error,
          resolution: 'rolled-back',
          finalRecord: res.serverRecord ?? action.previousSnapshot ?? null,
        };
      }

      case 'client-wins': {
        // Retain optimistic update, remove action from queue
        this.outbox.remove(action.id);
        const clientRecord = this.get(action.entity, action.recordId);
        return {
          action,
          error,
          resolution: 'overwritten',
          finalRecord: clientRecord,
        };
      }

      case 'reject-and-review': {
        // Revert local cache and flag action in outbox for manual inspection
        this.revertLocalSnapshot(action.entity, action.recordId, action.previousSnapshot);
        this.outbox.update(action.id, {
          status: 'conflict',
          error,
        });
        return {
          action,
          error,
          resolution: 'flagged-for-review',
          finalRecord: action.previousSnapshot ?? null,
        };
      }

      case 'last-write-wins': {
        const serverTs = res.serverTimestamp || 0;
        if (action.timestamp >= serverTs) {
          // Client is newer: retain
          this.outbox.remove(action.id);
          const clientRecord = this.get(action.entity, action.recordId);
          return {
            action,
            error,
            resolution: 'overwritten',
            finalRecord: clientRecord,
          };
        } else {
          // Server is newer: rollback
          if (res.serverRecord) {
            this.setCache(action.entity, action.recordId, res.serverRecord);
          } else {
            this.revertLocalSnapshot(action.entity, action.recordId, action.previousSnapshot);
          }
          this.outbox.remove(action.id);
          return {
            action,
            error,
            resolution: 'rolled-back',
            finalRecord: res.serverRecord ?? action.previousSnapshot ?? null,
          };
        }
      }
    }
  }
}
