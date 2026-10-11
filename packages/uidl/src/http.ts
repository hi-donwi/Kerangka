/**
 * A minimal JSON-over-fetch helper that speaks Kerangka's HTTP error contract.
 *
 * Kerangka answers failures with `application/problem+json`:
 * `{ type, title, status, detail, code, errors?: [{ field?, message, code }] }`
 * (`packages/server/src/server.ts` `sendProblem`). That is mapped to a `DataError` so the
 * document side, which only knows the UIDL error codes, sees a familiar shape.
 *
 * License: Apache-2.0
 */

import { DataError, type DataErrorCode } from "./errors.js";

export interface KerangkaHttpOptions {
  /** Base URL of the running Kerangka server, e.g. `http://localhost:8787`. */
  baseUrl: string;
  fetchImpl?: typeof fetch;
  /** Extra headers on every request, e.g. `X-Actor-Id` / `Authorization`. */
  headers?: Record<string, string>;
  timeoutMs?: number;
}

interface ProblemBody {
  code?: string;
  detail?: string;
  title?: string;
  errors?: Array<{ field?: string; message?: string }>;
  invalidParams?: Array<{ name?: string; reason?: string }>;
}

const STATUS_TO_CODE: Record<number, DataErrorCode> = {
  400: "validation",
  403: "forbidden",
  404: "not_found",
  408: "timeout",
  409: "conflict",
  422: "validation",
};

/** Kerangka error codes that refine the HTTP status into a UIDL error code. */
const KERANGKA_CODE_TO_DATA_CODE: Record<string, DataErrorCode> = {
  NOT_FOUND: "not_found",
  UNKNOWN_ENTITY: "not_found",
  FORBIDDEN: "forbidden",
  PERMISSION_DENIED: "forbidden",
  CONFLICT: "conflict",
  VERSION_CONFLICT: "conflict",
  INPUT_INVALID: "validation",
};

export interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Optimistic-concurrency token; sent as `If-Match` when present. */
  ifMatch?: number;
  /** Return `undefined` on 404 instead of throwing (used by `get`). */
  allowNotFound?: boolean;
  signal?: AbortSignal;
}

export interface RawResponse<T> {
  data: T;
  status: number;
  headers: Headers;
}

export function createKerangkaHttp(options: KerangkaHttpOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const resolvedFetch = options.fetchImpl ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined);
  const timeoutMs = options.timeoutMs ?? 15000;

  if (!resolvedFetch) {
    throw new DataError("no fetch implementation available", "network");
  }
  const doFetch: typeof fetch = resolvedFetch;

  async function requestRaw<T>(opts: RequestOptions): Promise<RawResponse<T>> {
    const url = `${baseUrl}${opts.path}${buildQuery(opts.query)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const onExternalAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", onExternalAbort, { once: true });

    try {
      const response = await doFetch(url, {
        method: opts.method,
        headers: {
          Accept: "application/json",
          ...(opts.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(opts.ifMatch === undefined ? {} : { "If-Match": String(opts.ifMatch) }),
          ...options.headers,
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: controller.signal,
      });

      if (opts.allowNotFound && response.status === 404) {
        return { data: undefined as T, status: 404, headers: response.headers };
      }
      if (!response.ok) throw await toDataError(response);
      if (response.status === 204) return { data: undefined as T, status: 204, headers: response.headers };
      return { data: (await response.json()) as T, status: response.status, headers: response.headers };
    } catch (error) {
      if (error instanceof DataError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new DataError("Kerangka request was aborted", "timeout");
      }
      throw new DataError(error instanceof Error ? error.message : "Kerangka request failed", "network");
    } finally {
      clearTimeout(timeout);
      opts.signal?.removeEventListener("abort", onExternalAbort);
    }
  }

  async function request<T>(opts: RequestOptions): Promise<T> {
    return (await requestRaw<T>(opts)).data;
  }

  return { request, requestRaw };
}

function buildQuery(query: Record<string, string | number | undefined> | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const rendered = params.toString();
  return rendered ? `?${rendered}` : "";
}

export async function toDataError(response: Response): Promise<DataError> {
  let body: ProblemBody | undefined;
  try {
    body = (await response.json()) as ProblemBody;
  } catch {
    body = undefined;
  }

  const code =
    (body?.code ? KERANGKA_CODE_TO_DATA_CODE[body.code] : undefined) ??
    STATUS_TO_CODE[response.status] ??
    (response.status >= 500 ? "server" : "validation");

  const fields = toFields(body?.errors, body?.invalidParams);
  const message = body?.detail ?? body?.title ?? `Kerangka responded ${response.status}`;
  return new DataError(message, code, fields);
}

function toFields(
  errors: ProblemBody["errors"],
  invalidParams?: ProblemBody["invalidParams"]
): Record<string, string> | undefined {
  const fields: Record<string, string> = {};
  if (Array.isArray(errors)) {
    for (const item of errors) {
      if (item && typeof item.field === "string" && typeof item.message === "string") {
        fields[item.field] = item.message;
      }
    }
  }
  if (Array.isArray(invalidParams)) {
    for (const item of invalidParams) {
      if (item && typeof item.name === "string" && typeof item.reason === "string") {
        fields[item.name] = item.reason;
      }
    }
  }
  return Object.keys(fields).length > 0 ? fields : undefined;
}
