/**
 * Kerangka Client Store Port Contract (Offline-first & local cache)
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

export interface SyncStatus {
  lastSyncAt?: string;
  pendingMutations: number;
  inConflict: boolean;
}

export interface ClientStorePort {
  /**
   * Retrieves a record from local browser / device storage.
   */
  get<T = Record<string, unknown>>(entityName: string, id: string): Promise<T | null>;

  /**
   * Saves a record locally, tagging it as pending sync if offline.
   */
  put<T = Record<string, unknown>>(entityName: string, id: string, record: T): Promise<void>;

  /**
   * Clears local entity cache.
   */
  clear(entityName?: string): Promise<void>;

  /**
   * Returns current synchronization status with the server.
   */
  getSyncStatus(): Promise<SyncStatus>;
}
