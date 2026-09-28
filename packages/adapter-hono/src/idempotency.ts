/**
 * Kerangka Idempotency-Key Support (PLAN.md §8.4 API table, ADR-0020 companion)
 * Specification Version: 0.3
 * Status: Draft
 * License: Apache-2.0
 *
 * Tracks mutating requests keyed by the client-supplied `Idempotency-Key` header:
 * replays the original response for identical retries, rejects key reuse with a
 * different payload (IDEMPOTENCY_CONFLICT), and rejects concurrent duplicates of
 * a request that is still in flight (IDEMPOTENCY_IN_PROGRESS).
 */

import { createHash } from "node:crypto";

export interface CachedResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  timestamp: number;
}

export type IdempotencyBeginResult =
  | { kind: "new" }
  | { kind: "replay"; res: CachedResponse }
  | { kind: "conflict"; res: CachedResponse }
  | { kind: "in-flight" };

export interface IdempotencyStore {
  /** Returns the cached response for a completed request, or null. */
  get(key: string): Promise<CachedResponse | null> | CachedResponse | null;
  /** Stores (or overwrites) the completed response for a key. */
  set(key: string, res: CachedResponse, ttlMs?: number): Promise<void> | void;
  /**
   * Marks a key as in flight and classifies the request. Optional: when absent,
   * adapters fall back to get/set-only behavior (no conflict or in-flight detection).
   */
  begin?(key: string, fingerprint: string, ttlMs?: number): IdempotencyBeginResult | Promise<IdempotencyBeginResult>;
  /** Records the successful response for a key begun earlier. */
  complete?(key: string, res: CachedResponse, ttlMs?: number): Promise<void> | void;
  /** Releases an in-flight key after a failure so the client may retry. */
  fail?(key: string): Promise<void> | void;
}

interface IdempotencyEntry {
  /** null while the request is in flight. */
  res: CachedResponse | null;
  fingerprint?: string;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const IN_FLIGHT_TTL_MS = 5 * 60 * 1000;

export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly store = new Map<string, IdempotencyEntry>();

  constructor(private readonly defaultTtlMs: number = DEFAULT_TTL_MS) {}

  get(key: string): CachedResponse | null {
    const entry = this.store.get(key);
    if (!entry || !entry.res) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.res;
  }

  set(key: string, res: CachedResponse, ttlMs = this.defaultTtlMs): void {
    const existing = this.store.get(key);
    this.store.set(key, {
      res,
      fingerprint: existing?.fingerprint,
      expiresAt: Date.now() + ttlMs,
    });
  }

  begin(key: string, fingerprint: string, ttlMs = this.defaultTtlMs): IdempotencyBeginResult {
    const now = Date.now();
    const existing = this.store.get(key);

    if (existing && now <= existing.expiresAt) {
      if (!existing.res) return { kind: "in-flight" };
      if (existing.fingerprint !== undefined && existing.fingerprint !== fingerprint) {
        return { kind: "conflict", res: existing.res };
      }
      // Sliding window: a legitimate retry refreshes the retention period.
      existing.expiresAt = now + ttlMs;
      return { kind: "replay", res: existing.res };
    }

    this.store.set(key, {
      res: null,
      fingerprint,
      expiresAt: now + Math.min(ttlMs, IN_FLIGHT_TTL_MS),
    });
    return { kind: "new" };
  }

  complete(key: string, res: CachedResponse, ttlMs = this.defaultTtlMs): void {
    const existing = this.store.get(key);
    this.store.set(key, {
      res,
      fingerprint: existing?.fingerprint,
      expiresAt: Date.now() + ttlMs,
    });
  }

  fail(key: string): void {
    const existing = this.store.get(key);
    // Release only in-flight keys; completed responses stay replayable.
    if (existing && !existing.res) this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

/** Deterministic JSON serialization with recursively sorted object keys. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * Computes a deterministic fingerprint of an idempotent request: method, path,
 * and the exact body payload. Identical retries must produce identical bodies
 * (semantically — object key order does not matter).
 */
export function computeRequestFingerprint(method: string, path: string, body: unknown): string {
  return createHash("sha256")
    .update(`${method.toUpperCase()} ${path} ${stableStringify(body ?? null)}`)
    .digest("hex");
}
