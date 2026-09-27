/**
 * Kerangka In-Memory Cache Adapter for testing
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import { CachePort } from "../cache.js";

interface CacheEntry {
  value: unknown;
  expiresAt?: number;
}

export class MemoryCache implements CachePort {
  private store = new Map<string, CacheEntry>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return structuredClone(entry.value) as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
    this.store.set(key, { value: structuredClone(value), expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async invalidatePattern(pattern: string): Promise<void> {
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
    for (const k of this.store.keys()) {
      if (regex.test(k)) {
        this.store.delete(k);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }
}
