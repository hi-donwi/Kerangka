/**
 * A UIDL `DataAdapter` backed by a running Kerangka server.
 *
 * It maps the document's data contract onto Kerangka's compiled REST semantics
 * (`packages/server/src/server.ts`):
 *
 * | adapter call | Kerangka request |
 * |---|---|
 * | `query`      | `GET    /api/{collection}?limit&offset&where&sort` |
 * | `get`        | `GET    /api/{collection}/{id}` |
 * | `create`     | `POST   /api/{collection}` |
 * | `update`     | `PUT    /api/{collection}/{id}` (`If-Match` from `Mutation.version`) |
 * | `remove`     | `DELETE /api/{collection}/{id}?soft=true` |
 * | `transition` | `POST   /api/{collection}/{id}/actions/{transition}` |
 *
 * Every record Kerangka returns carries a `version` column (`adapter-sqlite` defaults it to 1
 * and increments on update), which becomes `RecordMeta.version`; an `update` that names the
 * version it read is guarded by the server's optimistic-concurrency check.
 *
 * License: Apache-2.0
 */

import { DataError } from "./errors.js";
import { createKerangkaHttp, type KerangkaHttpOptions } from "./http.js";
import { applyQuery } from "./query.js";
import type { DataAdapter, Mutation, Query, QueryResult, RecordMeta } from "./types.js";

export interface KerangkaAdapterOptions extends KerangkaHttpOptions {
  /**
   * How many rows to scan when a query needs in-memory search. Structured filters and sort are
   * pushed to the server; free-text search still requires a bounded scan.
   */
  maxScanRows?: number;
  /**
   * Mark records deleted (`?soft=true`) instead of removing them. Off by default, so `remove`
   * matches UIDL's plain "the record is gone" expectation; turn it on for an audited model.
   */
  softDelete?: boolean;
}

type RawRecord = Record<string, unknown>;

function metaOf(record: RawRecord | undefined): RecordMeta {
  const version = record?.version;
  return { version: typeof version === "number" ? version : 1 };
}

function filtersToWhere(filters: Query["filters"]): unknown {
  const comparisons = (filters ?? []).map((filter) => {
    const operator = filter.op === "eq" ? "==" : filter.op === "ne" ? "!=" : filter.op;
    return [operator, ["get", filter.field], filter.value];
  });
  if (comparisons.length === 0) return undefined;
  return comparisons.length === 1 ? comparisons[0] : ["and", ...comparisons];
}

export function createKerangkaDataAdapter(options: KerangkaAdapterOptions): DataAdapter {
  const { request, requestRaw } = createKerangkaHttp(options);
  const maxScanRows = options.maxScanRows ?? 1000;
  const softDelete = options.softDelete ?? false;

  async function query<T = RawRecord>(query: Query, signal?: AbortSignal): Promise<QueryResult<T>> {
    const page = query.page;
    const pageSize = page?.size && page.size > 0 ? page.size : 50;
    const pageNumber = page?.number && page.number > 0 ? page.number : 1;

    const canPushDown = true;
    const needsScan = !canPushDown;

    const collection = encodeURIComponent(query.collection);

    if (!needsScan) {
      const { data, headers } = await requestRaw<RawRecord[]>({
        method: "GET",
        path: `/api/${collection}`,
        query: {
          limit: pageSize,
          offset: (pageNumber - 1) * pageSize,
          sort: query.sort?.length ? query.sort.map((sort) => `${sort.field}:${sort.dir}`).join(",") : undefined,
          where: filtersToWhere(query.filters) === undefined ? undefined : JSON.stringify(filtersToWhere(query.filters)),
          search: query.search?.trim() || undefined,
        },
        signal,
      });
      const rows = (data ?? []) as RawRecord[];
      const rawHeaderTotal = headers.get("X-Total-Count");
      const headerTotal = rawHeaderTotal === null ? Number.NaN : Number(rawHeaderTotal);
      const total = Number.isFinite(headerTotal) ? headerTotal : rows.length + (pageNumber - 1) * pageSize;
      const projected = query.fields?.length ? applyQuery(rows, { fields: query.fields }) : rows;
      return { rows: projected as T[], total, page: pageNumber, pageSize };
    }

    const scanned =
      (await request<RawRecord[]>({
        method: "GET",
        path: `/api/${collection}`,
        query: { limit: maxScanRows, offset: 0 },
        signal,
      })) ?? [];

    const filtered = applyQuery(scanned, {
      filters: query.filters,
      sort: query.sort,
      search: query.search,
    });
    const total = filtered.length;
    const start = (pageNumber - 1) * pageSize;
    const windowed = filtered.slice(start, start + pageSize);
    const projected = query.fields?.length ? applyQuery(windowed, { fields: query.fields }) : windowed;
    return { rows: projected as T[], total, page: pageNumber, pageSize };
  }

  async function get<T = RawRecord>(
    collection: string,
    id: string,
    signal?: AbortSignal,
  ): Promise<{ record: T; meta: RecordMeta } | undefined> {
    const record = await request<RawRecord | undefined>({
      method: "GET",
      path: `/api/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
      allowNotFound: true,
      signal,
    });
    if (!record) return undefined;
    return { record: record as T, meta: metaOf(record) };
  }

  async function create<T = RawRecord>(
    mutation: Mutation,
    signal?: AbortSignal,
  ): Promise<{ record: T; meta: RecordMeta }> {
    const record = await request<RawRecord>({
      method: "POST",
      path: `/api/${encodeURIComponent(mutation.collection)}`,
      body: mutation.data ?? {},
      signal,
    });
    return { record: record as T, meta: metaOf(record) };
  }

  async function update<T = RawRecord>(
    mutation: Mutation,
    signal?: AbortSignal,
  ): Promise<{ record: T; meta: RecordMeta }> {
    if (!mutation.id) throw new DataError("update requires an id", "validation");
    const record = await request<RawRecord>({
      method: "PUT",
      path: `/api/${encodeURIComponent(mutation.collection)}/${encodeURIComponent(mutation.id)}`,
      body: mutation.data ?? {},
      ifMatch: mutation.version,
      signal,
    });
    return { record: record as T, meta: metaOf(record) };
  }

  async function remove(collection: string, id: string, signal?: AbortSignal): Promise<void> {
    await request<void>({
      method: "DELETE",
      path: `/api/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
      query: softDelete ? { soft: "true" } : undefined,
      signal,
    });
  }

  async function transition<T = RawRecord>(
    mutation: Mutation & { transition: string },
    signal?: AbortSignal,
  ): Promise<{ record: T; meta: RecordMeta }> {
    if (!mutation.id) throw new DataError("transition requires an id", "validation");
    const payload = await request<{ record?: RawRecord } & RawRecord>({
      method: "POST",
      path: `/api/${encodeURIComponent(mutation.collection)}/${encodeURIComponent(mutation.id)}/actions/${encodeURIComponent(
        mutation.transition,
      )}`,
      body: mutation.data ?? {},
      signal,
    });
    const record = (payload?.record ?? payload) as RawRecord;
    return { record: record as T, meta: metaOf(record) };
  }

  async function report<T = unknown>(name: string, _params: Record<string, unknown>, _signal?: AbortSignal): Promise<T> {
    throw new DataError(
      `Kerangka has no reports endpoint; "${name}" must be served by a $query data source instead`,
      "validation",
    );
  }

  return { query, get, create, update, remove, transition, report };
}
