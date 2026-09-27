# @kerangka/client

Offline-first client runtime, mutation outbox, and action replay engine for Kerangka.

## Features

- **Action Replay Sync:** Implements ADR-0018 by replaying discrete mutation actions rather than fragile table diffs.
- **Optimistic Updates:** Immediate UI updates with automatic snapshots for clean rollback.
- **Idempotency Keys:** Every mutation carries a unique, deterministic idempotency key.
- **Configurable Conflict Policies:**
  - `server-wins`: Rolls back optimistic changes when server rejects; canonical server state wins.
  - `client-wins`: Overwrites server state with client modifications.
  - `reject-and-review`: Flags rejected mutations for user inspection without corrupting data.
  - `last-write-wins`: Timestamp comparison resolution.

## Installation

```bash
npm install @kerangka/client
```

## Usage

```typescript
import { KerangkaClient } from '@kerangka/client';

const client = new KerangkaClient({
  conflictPolicy: 'server-wins',
  transport: {
    send: async (action) => {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action),
      });
      return res.json();
    },
  },
});

// Mutates optimistically in local cache and enqueues to outbox
await client.mutate({
  entity: 'Task',
  type: 'create',
  recordId: 't-101',
  payload: { title: 'Implement offline sync', done: false },
});

// When online, flushes all queued mutations
await client.flush();
```

## License

Apache-2.0
