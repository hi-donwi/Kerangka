/**
 * Kerangka REST Cursor Pagination & Sorting Helpers
 * PLAN.md §8.4 API row: "named queries with filtering, sorting, and cursor pagination"
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import { QueryOptions } from "@kerangka/ports";

/**
 * Parses a `sort` query value into QueryOptions.sort. Accepts comma-separated
 * field names with an optional `+`/`-` prefix (`-createdAt,title`). The first
 * field is the primary sort key; MemoryStore sorts by the first entry.
 */
export function parseSortParam(sortParam: string | undefined): QueryOptions["sort"] | undefined {
  if (!sortParam) return undefined;

  const sort: Record<string, "asc" | "desc"> = {};
  for (const token of sortParam.split(",").map((t) => t.trim()).filter(Boolean)) {
    if (token.startsWith("-")) sort[token.slice(1)] = "desc";
    else if (token.startsWith("+")) sort[token.slice(1)] = "asc";
    else sort[token] = "asc";
  }

  return Object.keys(sort).length > 0 ? sort : undefined;
}

export interface CursorPayload {
  /** Primary sort field and direction, mirrored into the cursor for safety. */
  sort?: Record<string, "asc" | "desc">;
  /** Sort key values of the last record on the previous page. */
  last: Record<string, unknown>;
  /** Row offset of the next page (opaque to clients, honored internally). */
  offset: number;
}

/** Encodes a cursor payload as a URL-safe opaque string. */
export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/** Decodes an opaque cursor; returns null for malformed or foreign cursors. */
export function decodeCursor(cursor: string | undefined): CursorPayload | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as CursorPayload;
    if (typeof parsed !== "object" || parsed === null || typeof parsed.offset !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export interface PageLinks {
  next?: string;
}

/**
 * Builds the next-page cursor link from the final row of the current page.
 * Returns an empty object when the page is short (no more pages).
 */
export function buildNextCursor(params: {
  items: Record<string, unknown>[];
  limit: number;
  total: number;
  offset: number;
  sort?: QueryOptions["sort"];
  makeUrl: (cursor: string) => string;
}): PageLinks {
  const { items, limit, total, offset, sort, makeUrl } = params;
  const hasMore = offset + items.length < Math.min(total, offset + limit) || offset + limit < total;
  if (items.length === 0 || !hasMore) return {};

  const lastRecord = items[items.length - 1]!;
  const sortEntries = Object.entries(sort ?? {});
  const last: Record<string, unknown> = {};
  for (const [field] of sortEntries) {
    last[field] = lastRecord[field];
  }
  if (sortEntries.length === 0 && lastRecord.id !== undefined) {
    last["id"] = lastRecord["id"];
  }

  return { next: makeUrl(encodeCursor({ sort, last, offset: offset + items.length })) };
}
