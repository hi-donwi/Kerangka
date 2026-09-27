import { describe, it, expect, vi } from 'vitest';
import { KerangkaClient, OutboxQueue, type SyncTransport } from '../src/index.js';

describe('OutboxQueue', () => {
  it('enqueues mutations and preserves FIFO order', () => {
    const queue = new OutboxQueue();
    const a1 = queue.enqueue({
      entity: 'Task',
      type: 'create',
      recordId: 't-1',
      payload: { title: 'First Task' },
    });
    const a2 = queue.enqueue({
      entity: 'Task',
      type: 'update',
      recordId: 't-1',
      payload: { title: 'Updated Task' },
    });

    expect(queue.totalCount).toBe(2);
    expect(queue.pendingCount).toBe(2);
    expect(queue.peek()).toEqual([a1, a2]);
    expect(a1.id).toBeDefined();
    expect(a1.status).toBe('pending');
  });

  it('filters by status and removes items', () => {
    const queue = new OutboxQueue();
    const action = queue.enqueue({
      entity: 'Invoice',
      type: 'delete',
      recordId: 'inv-99',
      payload: {},
    });

    queue.update(action.id, { status: 'syncing' });
    expect(queue.peek('syncing').length).toBe(1);
    expect(queue.peek('pending').length).toBe(0);

    const removed = queue.remove(action.id);
    expect(removed).toBe(true);
    expect(queue.totalCount).toBe(0);
  });
});

describe('KerangkaClient Offline & Replay', () => {
  it('applies optimistic updates offline and keeps actions in outbox', async () => {
    const client = new KerangkaClient({ initialOnline: false });

    await client.mutate({
      entity: 'Todo',
      type: 'create',
      recordId: 'td-1',
      payload: { title: 'Buy groceries', done: false },
    });

    // Optimistic local state exists immediately
    const cached = client.get('Todo', 'td-1');
    expect(cached).toEqual({ id: 'td-1', title: 'Buy groceries', done: false });

    // Outbox holds pending mutation
    const status = client.getSyncStatus();
    expect(status.pendingMutations).toBe(1);
    expect(status.inConflict).toBe(false);
  });

  it('replays outbox actions over transport when online', async () => {
    const mockSend = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      serverRecord: { id: 'td-1', title: 'Buy groceries', done: false, serverSynced: true },
    });

    const transport: SyncTransport = { send: mockSend };
    const client = new KerangkaClient({ transport, initialOnline: false });

    await client.mutate({
      entity: 'Todo',
      type: 'create',
      recordId: 'td-1',
      payload: { title: 'Buy groceries', done: false },
    });

    expect(client.outbox.pendingCount).toBe(1);

    // Switch online and flush
    client.isOnline = true;
    const res = await client.flush();

    expect(res.syncedCount).toBe(1);
    expect(client.outbox.pendingCount).toBe(0);
    expect(mockSend).toHaveBeenCalledTimes(1);

    // Cache updated with server's response
    const cached = client.get('Todo', 'td-1') as any;
    expect(cached.serverSynced).toBe(true);
  });

  it('resolves conflicts using server-wins policy', async () => {
    const mockSend = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      error: 'Conflict: task already archived on server',
      serverRecord: { id: 'td-2', title: 'Original Task', done: true, archived: true },
    });

    const transport: SyncTransport = { send: mockSend };
    const client = new KerangkaClient({
      transport,
      conflictPolicy: 'server-wins',
      initialOnline: false,
    });

    // Seed initial state
    client.setCache('Todo', 'td-2', { id: 'td-2', title: 'Original Task', done: false });

    // Optimistic update
    await client.mutate({
      entity: 'Todo',
      type: 'update',
      recordId: 'td-2',
      payload: { title: 'Changed Offline', done: false },
    });

    expect(client.get('Todo', 'td-2')).toMatchObject({ title: 'Changed Offline' });

    // Replay with conflict
    client.isOnline = true;
    const res = await client.flush();

    expect(res.conflicts.length).toBe(1);
    expect(res.conflicts[0]!.resolution).toBe('rolled-back');

    // Cache reverted to serverRecord
    const current = client.get('Todo', 'td-2');
    expect(current).toEqual({ id: 'td-2', title: 'Original Task', done: true, archived: true });
    expect(client.outbox.pendingCount).toBe(0);
  });

  it('flags conflict for review under reject-and-review policy', async () => {
    const mockSend = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      error: 'Invariant violated: total cannot exceed budget limit',
    });

    const transport: SyncTransport = { send: mockSend };
    const client = new KerangkaClient({
      transport,
      conflictPolicy: 'reject-and-review',
      initialOnline: false,
    });

    client.setCache('Order', 'ord-1', { id: 'ord-1', total: 100 });

    await client.mutate({
      entity: 'Order',
      type: 'update',
      recordId: 'ord-1',
      payload: { total: 50000 },
    });

    client.isOnline = true;
    const res = await client.flush();

    expect(res.conflicts.length).toBe(1);
    expect(res.conflicts[0]!.resolution).toBe('flagged-for-review');

    // Cache was rolled back to previous snapshot
    expect(client.get('Order', 'ord-1')).toEqual({ id: 'ord-1', total: 100 });

    // Outbox holds conflict item
    expect(client.outbox.inConflict).toBe(true);
    expect(client.outbox.conflicts[0]!.status).toBe('conflict');
  });

  it('supports explicit rollback of optimistic mutation', async () => {
    const client = new KerangkaClient({ initialOnline: false });
    client.setCache('Note', 'n-1', { id: 'n-1', text: 'Original note' });

    const action = await client.mutate({
      entity: 'Note',
      type: 'update',
      recordId: 'n-1',
      payload: { text: 'New draft text' },
    });

    expect(client.get('Note', 'n-1')).toMatchObject({ text: 'New draft text' });

    const reverted = client.rollback(action.id);
    expect(reverted).toBe(true);
    expect(client.get('Note', 'n-1')).toEqual({ id: 'n-1', text: 'Original note' });
    expect(client.outbox.totalCount).toBe(0);
  });
});
