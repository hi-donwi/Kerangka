/**
 * The change stream: `GET /api/{entity}/events`.
 *
 * Boots a real `KerangkaServer` and reads the live `text/event-stream` over the wire, so the
 * status line, the SSE framing, and the events pushed after each committed mutation are all
 * exercised as a client would see them.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "@kerangka/compiler";
import { MemoryStore } from "@kerangka/ports";
import { KerangkaServer, type ChangeEvent } from "../src/index.js";

/**
 * These suites test what the server does for an authorized caller, so they run it as the dev
 * server does: a request with no actor acts as one holding every role the model declares.
 * `authorization.test.ts` covers the server with no dev actor.
 */
function devActorFor(model: { roles?: string[] }) {
  return { id: "dev-user", roles: model.roles ?? [] };
}

const here = path.dirname(fileURLToPath(import.meta.url));
const invoicingPath = path.resolve(here, "../../../examples/invoicing.kerangka.json");

interface SseHandle {
  next(): Promise<ChangeEvent>;
  close(): void;
}

function openStream(url: string, headers: Record<string, string> = {}): Promise<{ res: Response; sse: SseHandle }> {
  return fetch(url, { headers: { accept: "text/event-stream", ...headers } }).then((res) => {
    if (!res.body) throw new Error("no stream body");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let closed = false;

    async function next(): Promise<ChangeEvent> {
      for (;;) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
          if (dataLine) return JSON.parse(dataLine.slice(5).trim()) as ChangeEvent;
          continue; // comment/keep-alive frame
        }
        const { done, value } = await reader.read();
        if (done) throw new Error("stream ended before an event arrived");
        buffer += decoder.decode(value, { stream: true });
      }
    }

    return {
      res,
      sse: {
        next,
        close: () => {
          if (closed) return;
          closed = true;
          void reader.cancel().catch(() => undefined);
        },
      },
    };
  });
}

async function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const invoicePayload = (id: string) => ({
  id,
  number: id,
  customer: "cust-1",
  issuedOn: "2026-01-01",
  dueDate: "2030-01-01",
  status: "draft",
  lines: [{ description: "Consulting", qty: 2, unitPrice: 10 }],
});

describe("KerangkaServer change stream", () => {
  const port = 3993;
  const baseUrl = `http://localhost:${port}`;
  let server: KerangkaServer;

  beforeAll(async () => {
    const kir = compile(fs.readFileSync(invoicingPath, "utf-8"));
    server = new KerangkaServer(kir, { devActor: devActorFor(kir), port, store: new MemoryStore(), quiet: true });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("opens a text/event-stream and pushes create, update, action and delete changes", async () => {
    const { res, sse } = await openStream(`${baseUrl}/api/Invoice/events`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    try {
      const created = await post(`${baseUrl}/api/Invoice`, invoicePayload("INV-SSE-1"));
      expect(created.status).toBe(201);
      await expect(sse.next()).resolves.toMatchObject({
        entity: "Invoice",
        operation: "create",
        id: "INV-SSE-1",
      });

      const updated = await fetch(`${baseUrl}/api/Invoice/INV-SSE-1`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...invoicePayload("INV-SSE-1"), number: "INV-SSE-1a" }),
      });
      expect(updated.status).toBe(200);
      await expect(sse.next()).resolves.toMatchObject({ entity: "Invoice", operation: "update", id: "INV-SSE-1" });

      const action = await post(`${baseUrl}/api/Invoice/INV-SSE-1/actions/send`, {});
      expect(action.status).toBe(200);
      await expect(sse.next()).resolves.toMatchObject({
        entity: "Invoice",
        operation: "action",
        id: "INV-SSE-1",
        action: "send",
      });

      const deleted = await fetch(`${baseUrl}/api/Invoice/INV-SSE-1`, { method: "DELETE" });
      expect(deleted.status).toBe(204);
      await expect(sse.next()).resolves.toMatchObject({ entity: "Invoice", operation: "delete", id: "INV-SSE-1" });
    } finally {
      sse.close();
    }
  });

  it("rejects a non-GET subscription with an honest 405", async () => {
    const res = await post(`${baseUrl}/api/Invoice/events`, {}, { accept: "text/event-stream" });
    expect(res.status).toBe(405);
    const problem = await res.json();
    expect(problem.code).toBe("METHOD_NOT_ALLOWED");
  });

  it("scopes delivery to the subscriber's tenant", async () => {
    const { sse } = await openStream(`${baseUrl}/api/Invoice/events`, { "x-tenant-id": "tenant-1" });
    try {
      // A create under another tenant must not reach the tenant-1 subscriber; the tenant-1
      // create that follows must.
      await post(`${baseUrl}/api/Invoice`, invoicePayload("INV-T2"), { "x-tenant-id": "tenant-2" });
      await post(`${baseUrl}/api/Invoice`, invoicePayload("INV-T1"), { "x-tenant-id": "tenant-1" });

      await expect(sse.next()).resolves.toMatchObject({ operation: "create", id: "INV-T1" });
    } finally {
      sse.close();
    }
  });
});
