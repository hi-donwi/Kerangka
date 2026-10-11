/**
 * Client-side evaluation of a UIDL `$query` over rows already returned by Kerangka.
 *
 * Kerangka's REST collection read is `GET /api/{entity}?limit&offset` only — it does not accept
 * `filter`/`sort`/`search` (`packages/server/src/server.ts`). The store below it *does* support a
 * predicate (`QueryOptions.where`) but the endpoint does not expose it yet, so the bridge keeps
 * the list call byte-for-byte a Kerangka read and applies the rest of the query in memory. See
 * the run's `progress.md` for the server-side pushdown follow-up; this module is where that
 * would be replaced, and it is pure so it is the same code either way.
 *
 * License: Apache-2.0
 */

import type { QueryFilter, QuerySort, Query } from "./types.js";

function readPath(record: Record<string, unknown>, path: string): unknown {
  if (!path.includes(".")) return record[path];
  let current: unknown = record;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function writePath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".");
  let current = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i]!;
    const next = current[segment];
    if (next === null || typeof next !== "object") current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }
  current[segments[segments.length - 1]!] = value;
}

function compare(left: unknown, right: unknown): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  const ln = typeof left === "string" ? Number(left) : NaN;
  const rn = typeof right === "string" ? Number(right) : NaN;
  if (!Number.isNaN(ln) && !Number.isNaN(rn)) return ln - rn;
  return String(left ?? "").localeCompare(String(right ?? ""));
}

function matches(record: Record<string, unknown>, filter: QueryFilter): boolean {
  const actual = readPath(record, filter.field);
  switch (filter.op) {
    case "eq":
      return looseEquals(actual, filter.value);
    case "ne":
      return !looseEquals(actual, filter.value);
    case "in":
      return Array.isArray(filter.value) && filter.value.some((v) => looseEquals(actual, v));
    case "between": {
      if (!Array.isArray(filter.value) || filter.value.length !== 2) return false;
      const [min, max] = filter.value as [unknown, unknown];
      return compare(actual, min) >= 0 && compare(actual, max) <= 0;
    }
    case "gt":
      return compare(actual, filter.value) > 0;
    case "gte":
      return compare(actual, filter.value) >= 0;
    case "lt":
      return compare(actual, filter.value) < 0;
    case "lte":
      return compare(actual, filter.value) <= 0;
    case "like":
      return String(actual ?? "").toLowerCase().includes(String(filter.value ?? "").toLowerCase());
    default:
      return false;
  }
}

function looseEquals(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || left === undefined || right === null || right === undefined) return false;
  if (typeof left === "number" || typeof right === "number") {
    return Number(left) === Number(right);
  }
  return String(left) === String(right);
}

function toSearchable(record: Record<string, unknown>): string {
  const parts: string[] = [];
  const visit = (value: unknown): void => {
    if (value === null || value === undefined) return;
    if (typeof value === "object") {
      for (const nested of Object.values(value as Record<string, unknown>)) visit(nested);
      return;
    }
    parts.push(String(value));
  };
  visit(record);
  return parts.join(" ").toLowerCase();
}

function project(record: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) writePath(out, field, readPath(record, field));
  return out;
}

function sortRows(rows: Record<string, unknown>[], sort: QuerySort[]): Record<string, unknown>[] {
  const ordered = [...rows];
  ordered.sort((a, b) => {
    for (const clause of sort) {
      const result = compare(readPath(a, clause.field), readPath(b, clause.field));
      if (result !== 0) return clause.dir === "desc" ? -result : result;
    }
    return 0;
  });
  return ordered;
}

/** Applies filters, search, sort, and projection to a page of rows. Pure; order-independent. */
export function applyQuery<T = Record<string, unknown>>(
  rows: T[],
  query: Pick<Query, "filters" | "sort" | "search" | "fields">,
): T[] {
  let result = rows as unknown as Record<string, unknown>[];

  for (const filter of query.filters ?? []) {
    result = result.filter((row) => matches(row, filter));
  }

  const needle = query.search?.trim().toLowerCase();
  if (needle) {
    result = result.filter((row) => toSearchable(row).includes(needle));
  }

  if (query.sort && query.sort.length > 0) {
    result = sortRows(result, query.sort);
  }

  if (query.fields && query.fields.length > 0) {
    result = result.map((row) => project(row, query.fields!));
  }

  return result as unknown as T[];
}
