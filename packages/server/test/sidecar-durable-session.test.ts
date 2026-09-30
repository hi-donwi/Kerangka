import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compile } from "@kerangka/compiler";
import { loadEngine } from "@kerangka/engine-ts";
import { createJsonRpcDispatcher, SqliteSessionStore } from "../src/index.js";

/**
 * The in-memory session is honest about being a cache: a process that exits takes
 * unacknowledged events and unperformed effects with it. This store is the same
 * protocol over a file, so the promise a run makes survives the process that made it.
 *
 * The tests below are the feature: they close the store and open a new one, which is
 * what a restart is.
 */
const invoicing = loadEngine(
  compile(readFileSync(resolve(__dirname, "../../../examples/invoicing.kerangka.json"), "utf8"))
);

const billing = { id: "u-1", roles: ["billing"] };
const draft = {
  id: "inv-durable-1",
  number: "INV-DURABLE-1",
  customer: "cust-1",
  issuedOn: "2026-09-01",
  dueDate: "2026-10-01",
  status: "draft",
  lines: [{ description: "Consulting", qty: 1, unitPrice: 100 }],
};

function workspace(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "kerangka-session-"));
  return { path: join(dir, "session.db"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** A dispatcher over a store at `path`, as a process would build it. */
function sidecar(path: string) {
  const store = new SqliteSessionStore({ path });
  let id = 0;
  const dispatch = createJsonRpcDispatcher(invoicing, store);
  const call = (method: string, params: Record<string, unknown> = {}) => {
    id += 1;
    const line = dispatch(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    const response = JSON.parse(line as string) as {
      result?: unknown;
      error?: { code: number; message: string };
    };
    expect(response.error, `${method}: ${JSON.stringify(response.error)}`).toBeUndefined();
    return response.result as never;
  };
  return { store, call, close: () => store.close() };
}

const send = (call: (method: string, params?: Record<string, unknown>) => never) =>
  call("run", { action: "Invoice.send", record: draft, actor: billing }) as unknown as {
    commit: { persisted: number; enqueued: number; queuedEffects: number };
  };

describe("a durable sidecar session", () => {
  it("keeps the aggregate, the event, and the host's work across a restart", () => {
    const { path, cleanup } = workspace();
    try {
      const first = sidecar(path);
      const commit = send(first.call);
      expect(commit.commit).toMatchObject({ persisted: 1, enqueued: 1, queuedEffects: 1 });
      first.close();

      // A different store object, as a restarted process would build.
      const second = sidecar(path);
      const record = (second.call("get", { entity: "Invoice", id: "inv-durable-1" }) as unknown as {
        record: { status: string };
      }).record;
      expect(record.status).toBe("sent");

      const outbox = (second.call("outbox", {}) as unknown as { entries: Array<{ event: { type: string } }> })
        .entries;
      expect(outbox.map((entry) => entry.event.type)).toEqual(["InvoiceSent"]);

      const effects = (
        second.call("pendingEffects", {}) as unknown as {
          entries: Array<{ effect: { extension?: string; input?: Record<string, unknown> } }>;
        }
      ).entries;
      expect(effects[0]!.effect).toMatchObject({
        extension: "sendInvoiceEmail",
        input: { invoice: "inv-durable-1" },
      });
      second.close();
    } finally {
      cleanup();
    }
  });

  it("remembers a delivery that was acknowledged before the restart", () => {
    const { path, cleanup } = workspace();
    try {
      const first = sidecar(path);
      send(first.call);
      const entry = (first.call("outbox", {}) as unknown as { entries: Array<{ id: string }> }).entries[0]!;
      first.call("ack", { id: entry.id });
      first.close();

      const second = sidecar(path);
      expect((second.call("outbox", {}) as unknown as { entries: unknown[] }).entries).toHaveLength(0);
      // History survives, so a host can still see what it already delivered.
      expect((second.call("events", {}) as unknown as { events: unknown[] }).events).toHaveLength(1);
      second.close();
    } finally {
      cleanup();
    }
  });

  it("remembers a failed delivery, so the retry outlives the process", () => {
    const { path, cleanup } = workspace();
    try {
      const first = sidecar(path);
      send(first.call);
      const entry = (first.call("outbox", {}) as unknown as { entries: Array<{ id: string }> }).entries[0]!;
      (first.call("nack", { id: entry.id, error: "broker unreachable" }) as unknown as {
        entry: { attempts: number; lastError?: string };
      }).entry.attempts;
      first.close();

      const second = sidecar(path);
      const retried = (second.call("outbox", {}) as unknown as {
        entries: Array<{ attempts: number; lastError?: string; state: string }>;
      }).entries[0]!;
      expect(retried.state).toBe("pending");
      expect(retried.attempts).toBe(1);
      expect(retried.lastError).toBe("broker unreachable");
      second.close();
    } finally {
      cleanup();
    }
  });

  it("writes neither half when one aggregate cannot be stored", () => {
    const { path, cleanup } = workspace();
    try {
      const store = new SqliteSessionStore({ path });
      expect(() =>
        store.applyEffects(
          "Invoice",
          [
            { type: "call", extension: "sendInvoiceEmail", input: {} },
            { type: "persist", entity: "Invoice", record: { number: "no id" } },
          ] as never,
          [
            {
              specversion: "1.0",
              id: "evt-unstorable",
              source: "kerangka/test",
              type: "InvoiceSent",
              time: "2026-09-30T00:00:00.000Z",
              data: {},
            } as never,
          ]
        )
      ).toThrow(/no string 'id'/);

      // The transaction rolled back: no event, no effect, no revision spent.
      expect(store.pending()).toHaveLength(0);
      expect(store.pendingEffects()).toHaveLength(0);
      expect(store.revisionOf("Invoice", "anything")).toBeNull();
      store.close();
    } finally {
      cleanup();
    }
  });

  it("keeps claims across a restart, so a replayed event does not run twice", () => {
    const { path, cleanup } = workspace();
    try {
      const first = sidecar(path);
      expect(first.store.claim("evt-1:billing.onOrderPlaced")).toBe(true);
      first.close();

      const second = sidecar(path);
      expect(second.store.claim("evt-1:billing.onOrderPlaced")).toBe(false);
      expect(second.store.claims()).toEqual(["evt-1:billing.onOrderPlaced"]);
      second.close();
    } finally {
      cleanup();
    }
  });

  it("keeps a lost update detectable, because the revision is persisted", () => {
    const { path, cleanup } = workspace();
    try {
      const first = sidecar(path);
      send(first.call);
      const revision = first.store.revisionOf("Invoice", "inv-durable-1");
      first.close();

      const second = sidecar(path);
      expect(second.store.revisionOf("Invoice", "inv-durable-1")).toBe(revision);
      // A second run advances it, so a host that cached the old one can tell.
      send(second.call);
      expect(second.store.revisionOf("Invoice", "inv-durable-1")).toBeGreaterThan(revision!);
      second.close();
    } finally {
      cleanup();
    }
  });

  it("clears the session without leaving the file unusable", () => {
    const { path, cleanup } = workspace();
    try {
      const first = sidecar(path);
      send(first.call);
      first.call("clear", {});
      first.close();

      const second = sidecar(path);
      expect((second.call("list", { entity: "Invoice" }) as unknown as { records: unknown[] }).records)
        .toHaveLength(0);
      expect(second.store.pending()).toHaveLength(0);
      // And the store still works afterwards.
      send(second.call);
      expect(second.store.get("Invoice", "inv-durable-1")?.status).toBe("sent");
      second.close();
    } finally {
      cleanup();
    }
  });

  it("speaks the same protocol as the in-memory store", () => {
    const { path, cleanup } = workspace();
    try {
      const durable = sidecar(path);
      const memory = sidecar(":memory:");
      for (const target of [durable, memory]) {
        send(target.call);
      }

      const shape = (target: ReturnType<typeof sidecar>) => ({
        outbox: (target.call("outbox", {}) as unknown as { entries: unknown[] }),
        record: (target.call("get", { entity: "Invoice", id: "inv-durable-1" }) as unknown as {
          record: unknown;
        }),
        effects: (target.call("pendingEffects", {}) as unknown as { entries: unknown[] }),
        entities: target.store.entities(),
      });

      // The same call sequence produces the same answers, which is what "the protocol
      // does not change" has to mean.
      expect(Object.keys(shape(durable)).sort()).toEqual(Object.keys(shape(memory)).sort());
      expect(durable.store.get("Invoice", "inv-durable-1")).toEqual(
        memory.store.get("Invoice", "inv-durable-1")
      );
      expect(durable.store.pending().map((entry) => entry.event.type)).toEqual(
        memory.store.pending().map((entry) => entry.event.type)
      );
      durable.close();
      memory.close();
    } finally {
      cleanup();
    }
  });
});
