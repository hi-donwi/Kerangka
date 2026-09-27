/**
 * Kerangka Client & Outbox Engine Types
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

export type MutationActionType = 'create' | 'update' | 'delete' | 'transition';

export type MutationStatus = 'pending' | 'syncing' | 'committed' | 'failed' | 'conflict';

export type ConflictPolicy =
  | 'server-wins'
  | 'client-wins'
  | 'reject-and-review'
  | 'last-write-wins';

export interface MutationAction {
  /** Unique idempotency key for this mutation */
  id: string;
  /** Target entity name in the Kerangka model */
  entity: string;
  /** Type of mutation action */
  type: MutationActionType;
  /** ID of the affected record */
  recordId: string;
  /** Payload / partial data to mutate */
  payload: Record<string, unknown>;
  /** Optional workflow transition name */
  transition?: string;
  /** Client creation timestamp (epoch ms) */
  timestamp: number;
  /** Current synchronization status */
  status: MutationStatus;
  /** Number of failed attempts */
  retryCount: number;
  /** Previous record state for rollback if server rejects */
  previousSnapshot?: Record<string, unknown> | null;
  /** Error message if rejected or failed */
  error?: string;
}

export interface TransportResponse {
  ok: boolean;
  status: number;
  data?: unknown;
  error?: string;
  serverRecord?: Record<string, unknown>;
  serverTimestamp?: number;
}

export interface SyncTransport {
  send(action: MutationAction): Promise<TransportResponse>;
}

export interface ConflictResolution {
  action: MutationAction;
  error: string;
  resolution: 'rolled-back' | 'overwritten' | 'flagged-for-review';
  finalRecord?: Record<string, unknown> | null;
}

export interface FlushResult {
  syncedCount: number;
  conflicts: ConflictResolution[];
  failedCount: number;
}
