/**
 * Subscribe to an entity's change feed: `GET /api/{entity}/events`, a `text/event-stream` the
 * Kerangka server pushes a `change` event to after every committed mutation.
 *
 * The stream is a *notification*, not the new record — the server sends which entity changed,
 * the operation, and the record id, and the subscribed view re-runs its `$query` rather than
 * patching from the payload. That keeps a live list correct under the filtering, sorting and
 * pagination the event cannot describe.
 *
 * No dependency on `EventSource`: a fetch body stream works in the browser and in Node alike,
 * and reconnection is explicit here so a host can see and control it. `close()` is the only
 * thing needed to tear a subscription down.
 *
 * License: Apache-2.0
 */

import { DataError } from "./errors.js";
import { toDataError } from "./http.js";

/** Mirrors the server's `ChangeEvent` (`@kerangka/server`). */
export interface ChangeEvent {
  entity: string;
  operation: "create" | "update" | "delete" | "action";
  id: string;
  version?: number;
  /** Present when `operation` is `"action"`. */
  action?: string;
  /** ISO-8601 commit time. */
  at: string;
}

export interface ReconnectOptions {
  /** Delay before the first retry. Default 1000ms. */
  initialDelayMs?: number;
  /** Ceiling for the exponential backoff. Default 30000ms. */
  maxDelayMs?: number;
  /** Give up after this many consecutive failed attempts. Default `Infinity`. */
  maxAttempts?: number;
}

export interface SubscribeChangesOptions {
  /** Base URL of the running Kerangka server, e.g. `http://localhost:8787`. */
  baseUrl: string;
  /** Entity (collection) to follow. */
  entity: string;
  /** Scope delivery to one tenant; the server drops changes committed under another. */
  tenantId?: string;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
  /** Abort the subscription from outside as well as via `close()`. */
  signal?: AbortSignal;
  onEvent: (event: ChangeEvent) => void;
  /** Called on a transport error or a non-OK response (already a `DataError`). */
  onError?: (error: unknown) => void;
  /** Called once the stream is open, and again after each successful reconnect. */
  onOpen?: () => void;
  /** Retry policy. Pass `false` to disable reconnection. Default enabled. */
  reconnect?: ReconnectOptions | false;
}

export interface Subscription {
  /** Stop the subscription and release the connection. Idempotent. */
  close(): void;
}

/**
 * Opens a change subscription and returns a handle. The stream reconnects with exponential
 * backoff by default; every failure is reported through `onError` so a host is never silently
 * blind to a dead feed.
 */
export function subscribeChanges(options: SubscribeChangesOptions): Subscription {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined);
  if (!fetchImpl) throw new DataError("no fetch implementation available", "network");

  const reconnect = options.reconnect === false ? null : {
    initialDelayMs: options.reconnect?.initialDelayMs ?? 1000,
    maxDelayMs: options.reconnect?.maxDelayMs ?? 30000,
    maxAttempts: options.reconnect?.maxAttempts ?? Infinity,
  };

  const params = new URLSearchParams();
  if (options.tenantId !== undefined) params.set("tenantId", options.tenantId);
  const query = params.toString();
  const url = `${baseUrl}/api/${encodeURIComponent(options.entity)}/events${query ? `?${query}` : ""}`;

  let controller: AbortController | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let closed = false;

  const onExternalAbort = () => close();
  options.signal?.addEventListener("abort", onExternalAbort, { once: true });

  function close(): void {
    if (closed) return;
    closed = true;
    if (retryTimer !== null) clearTimeout(retryTimer);
    controller?.abort();
    options.signal?.removeEventListener("abort", onExternalAbort);
  }

  function scheduleReconnect(): void {
    if (closed || !reconnect) return;
    if (attempt >= reconnect.maxAttempts) {
      options.onError?.(new DataError("change stream gave up after repeated failures", "network"));
      return;
    }
    const delay = Math.min(reconnect.maxDelayMs, reconnect.initialDelayMs * 2 ** attempt);
    attempt += 1;
    retryTimer = setTimeout(() => void connect(), delay);
  }

  async function connect(): Promise<void> {
    if (closed) return;
    controller = new AbortController();
    try {
      const response = await fetchImpl!(url, {
        method: "GET",
        headers: { Accept: "text/event-stream", ...options.headers },
        signal: controller.signal,
      });
      if (!response.ok) {
        options.onError?.(await toDataError(response));
        scheduleReconnect();
        return;
      }
      if (!response.body) {
        options.onError?.(new DataError("change stream returned no body", "network"));
        scheduleReconnect();
        return;
      }

      attempt = 0;
      options.onOpen?.();

      await readEventStream(response.body, options.onEvent);
      // A clean end is still the feed stopping: reconnect unless the caller closed us.
      scheduleReconnect();
    } catch (error) {
      if (closed) return;
      options.onError?.(error instanceof DataError ? error : new DataError(
        error instanceof Error ? error.message : "change stream failed",
        "network",
      ));
      scheduleReconnect();
    }
  }

  void connect();

  return { close };
}

/** Reads SSE frames off a body stream, dispatching `change` (and unnamed) events. */
async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ChangeEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "";
  let dataLines: string[] = [];

  const dispatch = () => {
    if (dataLines.length === 0) return;
    const data = dataLines.join("\n");
    const name = eventName;
    eventName = "";
    dataLines = [];
    // The server names its events `change`; a nameless frame is the SSE default and is treated
    // the same. Any other name is a protocol extension this client does not yet know.
    if (name !== "" && name !== "change") return;
    let parsed: ChangeEvent;
    try {
      parsed = JSON.parse(data) as ChangeEvent;
    } catch {
      return;
    }
    onEvent(parsed);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const rawLine = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

      if (line === "") {
        dispatch();
      } else if (line.startsWith(":")) {
        // Comment/keep-alive line.
        continue;
      } else {
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") eventName = value;
        else if (field === "data") dataLines.push(value);
      }
    }
  }
  dispatch();
}
