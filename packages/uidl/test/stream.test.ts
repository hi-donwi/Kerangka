/**
 * `subscribeChanges` against a fake `fetch`, so the SSE parsing, error mapping, reconnection and
 * teardown are exercised without a real server. `bridge.integration.test.ts` covers the wire.
 */
import { describe, expect, it, vi } from "vitest";
import { subscribeChanges, type ChangeEvent } from "../src/stream.js";

function sseResponse(frames: string, init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(frames));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
    ...init,
  });
}

/** Emits the frames but never closes, so the subscription stays parked on the connection. */
function openSseResponse(frames: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (frames) controller.enqueue(encoder.encode(frames));
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const frame = (event: Partial<ChangeEvent>): string =>
  `event: change\ndata: ${JSON.stringify({ entity: "Invoice", at: "t", ...event })}\n\n`;

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("subscribeChanges", () => {
  it("parses change frames and reports the connection open", async () => {
    const events: ChangeEvent[] = [];
    let opened = 0;
    const sub = subscribeChanges({
      baseUrl: "http://server/",
      entity: "Invoice",
      fetchImpl: async () => sseResponse(": connected\n\n" + frame({ operation: "create", id: "INV-1" })),
      onEvent: (event) => events.push(event),
      onOpen: () => (opened += 1),
      reconnect: false,
    });

    await waitFor(() => events.length === 1);
    expect(events[0]).toMatchObject({ entity: "Invoice", operation: "create", id: "INV-1" });
    expect(opened).toBe(1);
    sub.close();
  });

  it("ignores keep-alive comments and unknown event names", async () => {
    const events: ChangeEvent[] = [];
    const sub = subscribeChanges({
      baseUrl: "http://server",
      entity: "Invoice",
      fetchImpl: async () =>
        sseResponse(": ping\n\nevent: other\ndata: {\"x\":1}\n\n" + frame({ operation: "update", id: "INV-2" })),
      onEvent: (event) => events.push(event),
      reconnect: false,
    });

    await waitFor(() => events.length === 1);
    // No wait-and-see window: only the `change` frame was ever dispatched.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ operation: "update", id: "INV-2" });
    sub.close();
  });

  it("maps a non-OK response to a DataError and stops when reconnection is off", async () => {
    const errors: unknown[] = [];
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ code: "FORBIDDEN", detail: "not allowed" }), {
        status: 403,
        headers: { "content-type": "application/problem+json" },
      }),
    );
    const sub = subscribeChanges({
      baseUrl: "http://server",
      entity: "Invoice",
      fetchImpl,
      onEvent: () => undefined,
      onError: (error) => errors.push(error),
      reconnect: false,
    });

    await waitFor(() => errors.length === 1);
    expect(errors[0]).toMatchObject({ name: "DataError", code: "forbidden" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    sub.close();
  });

  it("reconnects after the stream ends", async () => {
    const events: ChangeEvent[] = [];
    let calls = 0;
    const sub = subscribeChanges({
      baseUrl: "http://server",
      entity: "Invoice",
      fetchImpl: async () => {
        calls += 1;
        // First connection ends immediately (forcing a reconnect); the second stays open, so
        // exactly one event arrives on each connection and no further retry is scheduled.
        return calls === 1
          ? sseResponse(frame({ operation: "create", id: "INV-1" }))
          : openSseResponse(frame({ operation: "update", id: "INV-1" }));
      },
      onEvent: (event) => events.push(event),
      reconnect: { initialDelayMs: 1, maxAttempts: 3 },
    });

    await waitFor(() => events.length >= 2);
    expect(events.map((event) => event.operation)).toEqual(["create", "update"]);
    expect(calls).toBe(2);
    sub.close();
  });

  it("aborts the connection on close", async () => {
    let signal: AbortSignal | undefined;
    const sub = subscribeChanges({
      baseUrl: "http://server",
      entity: "Invoice",
      fetchImpl: async (_url: RequestInfo | URL, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        // A stream that never ends: the reader stays parked until the abort.
        return openSseResponse("");
      },
      onEvent: () => undefined,
      reconnect: false,
    });

    await waitFor(() => signal !== undefined);
    sub.close();
    expect(signal?.aborted).toBe(true);
  });

  it("passes tenantId through as a query parameter", async () => {
    let requested = "";
    const sub = subscribeChanges({
      baseUrl: "http://server",
      entity: "Invoice",
      tenantId: "tenant-1",
      fetchImpl: async (url: RequestInfo | URL) => {
        requested = String(url);
        return sseResponse("");
      },
      onEvent: () => undefined,
      reconnect: false,
    });

    await waitFor(() => requested !== "");
    expect(requested).toBe("http://server/api/Invoice/events?tenantId=tenant-1");
    sub.close();
  });
});
