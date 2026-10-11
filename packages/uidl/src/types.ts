/**
 * The host contract a UIDL document renders against.
 *
 * These interfaces are **structurally identical** to the ones UIDL-Runtime ships
 * (`UIDL-Runtime/packages/core/src/data/types.ts` for the adapter and
 * `.../src/types/actions.ts` for the mutation handler), quote for quote. They are declared
 * here rather than imported because Kerangka does not take a dependency on the runtime — the
 * document travels between the two repositories as JSON, and the bridge only has to satisfy
 * the shape. A host that passes `createKerangkaDataAdapter(...)` straight into
 * `UIDocumentRenderer` type-checks against the runtime's own `DataAdapter` with no cast.
 *
 * Specification Version: 1.x
 * License: Apache-2.0
 */

export type QueryOp = "eq" | "ne" | "in" | "gt" | "gte" | "lt" | "lte" | "like" | "between";

export interface QueryFilter {
  field: string;
  op: QueryOp;
  /** `in`/`between` take an array; every other op takes a scalar. */
  value: unknown;
}

export interface QuerySort {
  field: string;
  dir: "asc" | "desc";
}

export interface QueryPage {
  /** 1-based. */
  number: number;
  size: number;
}

export interface Query {
  collection: string;
  filters?: QueryFilter[];
  sort?: QuerySort[];
  page?: QueryPage;
  /** Free-text search across whatever fields the collection marks searchable. */
  search?: string;
  /** Column projection; omitted = every field. */
  fields?: string[];
}

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Mutation {
  collection: string;
  id?: string;
  data?: Record<string, unknown>;
  /** State-machine transition name, e.g. `"send"` | `"pay"` | `"void"`. */
  transition?: string;
  /** Optimistic-concurrency token: the version the client last read. */
  version?: number;
}

export interface RecordMeta {
  version: number;
}

export interface DataAdapter {
  query<T = Record<string, unknown>>(query: Query, signal?: AbortSignal): Promise<QueryResult<T>>;
  get<T = Record<string, unknown>>(
    collection: string,
    id: string,
    signal?: AbortSignal,
  ): Promise<{ record: T; meta: RecordMeta } | undefined>;
  create<T = Record<string, unknown>>(mutation: Mutation, signal?: AbortSignal): Promise<{ record: T; meta: RecordMeta }>;
  update<T = Record<string, unknown>>(mutation: Mutation, signal?: AbortSignal): Promise<{ record: T; meta: RecordMeta }>;
  remove(collection: string, id: string, signal?: AbortSignal): Promise<void>;
  transition<T = Record<string, unknown>>(
    mutation: Mutation & { transition: string },
    signal?: AbortSignal,
  ): Promise<{ record: T; meta: RecordMeta }>;
  report<T = unknown>(name: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<T>;
}

export type MutationOperation = "create" | "update" | "delete" | "transition";

export interface MutationRequest {
  operation: MutationOperation;
  collection: string;
  id?: string | number;
  payload?: Record<string, unknown>;
  transition?: string;
  version?: number;
}

export type MutationHandler = (request: MutationRequest) => Promise<unknown> | unknown;
