/**
 * Kerangka Idempotency-Key Support (IETF draft / RFC 9457 companion)
 * Specification Version: 0.2
 * Status: Draft
 * License: Apache-2.0
 */

export interface CachedResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  timestamp: number;
}

export interface IdempotencyStore {
  get(key: string): Promise<CachedResponse | null> | CachedResponse | null;
  set(key: string, res: CachedResponse, ttlMs?: number): Promise<void> | void;
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly store = new Map<string, { res: CachedResponse; expiresAt: number }>();

  get(key: string): CachedResponse | null {
    const item = this.store.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return item.res;
  }

  set(key: string, res: CachedResponse, ttlMs = 86400000): void {
    this.store.set(key, { res, expiresAt: Date.now() + ttlMs });
  }

  clear(): void {
    this.store.clear();
  }
}
