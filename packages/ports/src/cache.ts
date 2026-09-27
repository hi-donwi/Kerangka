/**
 * Kerangka Cache Port Contract
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

export interface CachePort {
  /**
   * Retrieves a cached value by key.
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Sets a value in the cache with an optional time-to-live in seconds.
   */
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;

  /**
   * Deletes a cached entry by key.
   */
  delete(key: string): Promise<void>;

  /**
   * Invalidates all keys matching a prefix or pattern (e.g. "Customer:*").
   */
  invalidatePattern(pattern: string): Promise<void>;
}
