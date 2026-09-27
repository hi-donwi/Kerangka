/**
 * Kerangka Outbox Mutation Queue
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import type { MutationAction, MutationStatus } from './types.js';

let counter = 0;
function generateIdempotencyKey(): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 9);
  return `mut-${Date.now()}-${counter}-${rand}`;
}

export class OutboxQueue {
  private queue: MutationAction[] = [];

  constructor(initialItems: MutationAction[] = []) {
    this.queue = [...initialItems];
  }

  /**
   * Enqueues a new mutation action into the outbox.
   */
  enqueue(
    item: Omit<MutationAction, 'id' | 'timestamp' | 'status' | 'retryCount'> &
      Partial<Pick<MutationAction, 'id' | 'timestamp'>>
  ): MutationAction {
    const action: MutationAction = {
      id: item.id || generateIdempotencyKey(),
      entity: item.entity,
      type: item.type,
      recordId: item.recordId,
      payload: item.payload,
      transition: item.transition,
      timestamp: item.timestamp ?? Date.now(),
      status: 'pending',
      retryCount: 0,
      previousSnapshot: item.previousSnapshot,
    };

    this.queue.push(action);
    return action;
  }

  /**
   * Returns all items matching an optional status, or all items in FIFO order.
   */
  peek(status?: MutationStatus): MutationAction[] {
    if (!status) {
      return [...this.queue];
    }
    return this.queue.filter((item) => item.status === status);
  }

  /**
   * Retrieves an item by its idempotency ID.
   */
  get(id: string): MutationAction | undefined {
    return this.queue.find((item) => item.id === id);
  }

  /**
   * Updates fields on an existing mutation action in the queue.
   */
  update(id: string, updates: Partial<Omit<MutationAction, 'id'>>): void {
    const idx = this.queue.findIndex((item) => item.id === id);
    if (idx !== -1) {
      const existing = this.queue[idx]!;
      this.queue[idx] = { ...existing, ...updates };
    }
  }

  /**
   * Removes an action from the queue once committed or cancelled.
   */
  remove(id: string): boolean {
    const initialLen = this.queue.length;
    this.queue = this.queue.filter((item) => item.id !== id);
    return this.queue.length < initialLen;
  }

  /**
   * Clears all items from the outbox.
   */
  clear(): void {
    this.queue = [];
  }

  get pendingCount(): number {
    return this.queue.filter((item) => item.status === 'pending' || item.status === 'syncing').length;
  }

  get totalCount(): number {
    return this.queue.length;
  }

  get inConflict(): boolean {
    return this.queue.some((item) => item.status === 'conflict');
  }

  get conflicts(): MutationAction[] {
    return this.queue.filter((item) => item.status === 'conflict');
  }
}
