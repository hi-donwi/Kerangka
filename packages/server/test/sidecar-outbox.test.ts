import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compile } from "@kerangka/compiler";
import { loadEngine } from "@kerangka/engine-ts";
import { createJsonRpcDispatcher, SessionStore } from "../src/index.js";

/**
 * An execution's aggregates and its events are one commit, and the events wait in an
 * outbox until a host says they were delivered. Neither half is worth much alone: a
 * stored aggregate with a lost event is a lie nobody hears about, and a delivered
 * event with no stored aggregate is a notification of nothing.
 */
const invoicing = loadEngine(
  compile(readFileSync(resolve(__dirname, "../../../examples/invoicing.kerangka.json"), "utf8"))
);

const billing = { id: "u-1", roles: ["billing"] };
const draft = {
  id: "inv-outbox-1",
  number: "INV-OUTBOX-1",
  customer: "cust-1",
  issuedOn: "2026-09-01",
  dueDate: "2026-10-01",
  status: "draft",
  lines: [{ description: "Consulting", qty: 1, unitPrice: 100 }],
};

function session(engine = invoicing) {
  const store = new SessionStore();
  const dispatch = createJsonRpcDispatcher(engine, store);
  let id = 0;
  const raw = (method: string, params: Record<string, unknown> = {}) => {
    id += 1;
    const line = dispatch(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return JSON.parse(line as string) as { result?: unknown; error?: { code: number; data?: unknown } };
  };
  const call = (method: string, params: Record<string, unknown> = {}) => {
    const response = raw(method, params);
    expect(response.error, `${method}: ${JSON.stringify(response.error)}`).toBeUndefined();
    return response.result as never;
  };
  return { store, call, raw };
}

type Entry = { id: string; event: { type: string }; attempts: number; state: string; lastError?: string };

describe("a commit, or nothing", () => {
  it("stores the aggregate and queues its event together", () => {
    const { store, call } = session();

    const sent = call("run", { action: "Invoice.send", record: draft, actor: billing });
    const commit = (sent as { commit: { persisted: number; enqueued: number; ids: string[] } }).commit;

    expect(commit).toEqual({ persisted: 1, enqueued: 1, ids: ["inv-outbox-1"] });
    expect(store.get("Invoice", "inv-outbox-1")?.status).toBe("sent");
    expect(store.pending()).toHaveLength(1);
  });

  it("writes neither half when one aggregate cannot be stored", () => {
    // Two persist effects, the second unaddressable: the first must not survive either.
    const store = new SessionStore();
    const effect = (record: Record<string, unknown>) =>
      ({ type: "persist", entity: "Invoice", record }) as never;
    const event = {
      specversion: "1.0" as const,
      id: "evt-x",
      source: "kerangka/test",
      type: "InvoiceSent",
      time: "2026-09-30T00:00:00.000Z",
      datacontenttype: "application/json" as const,
      data: {},
    };

    expect(() =>
      store.applyEffects("Invoice", [effect(draft), effect({ number: "no-id" })], [event])
    ).toThrow(/no string 'id'/);

    expect(store.list("Invoice")).toEqual([]);
    expect(store.pending()).toEqual([]);
    expect(store.events()).toEqual([]);
  });
});

describe("the outbox", () => {
  it("queues an event until a host acknowledges it", () => {
    const { call } = session();
    call("run", { action: "Invoice.send", record: draft, actor: billing });

    const pending = call("outbox") as { entries: Entry[] };
    expect(pending.entries).toHaveLength(1);
    expect(pending.entries[0]?.event.type).toBe("InvoiceSent");
    expect(pending.entries[0]?.state).toBe("pending");
    expect(pending.entries[0]?.attempts).toBe(0);

    const acked = call("ack", { id: pending.entries[0]?.id }) as { entry: Entry };
    expect(acked.entry.state).toBe("delivered");

    expect((call("outbox") as { entries: Entry[] }).entries).toEqual([]);
  });

  it("keeps a failed delivery pending so it can be retried", () => {
    const { call } = session();
    call("run", { action: "Invoice.send", record: draft, actor: billing });
    const id = ((call("outbox") as { entries: Entry[] }).entries[0]?.id) as string;

    const first = call("nack", { id, error: "broker unreachable" }) as { entry: Entry };
    expect(first.entry.state).toBe("pending");
    expect(first.entry.attempts).toBe(1);
    expect(first.entry.lastError).toBe("broker unreachable");

    const second = call("nack", { id, error: "broker unreachable" }) as { entry: Entry };
    expect(second.entry.attempts).toBe(2);

    // Still queued, and still the same event: a retry never invents a new one.
    const pending = call("outbox") as { entries: Entry[] };
    expect(pending.entries).toHaveLength(1);
    expect(pending.entries[0]?.attempts).toBe(2);

    const acked = call("ack", { id }) as { entry: Entry };
    expect(acked.entry.state).toBe("delivered");
    expect(acked.entry.lastError).toBeUndefined();
  });

  it("remembers delivered events as history", () => {
    const { call } = session();
    call("run", { action: "Invoice.send", record: draft, actor: billing });
    const id = ((call("outbox") as { entries: Entry[] }).entries[0]?.id) as string;
    call("ack", { id });

    // The history stays: an audit trail that forgets what was delivered is not one.
    expect((call("events") as { events: { type: string }[] }).events).toHaveLength(1);
    expect((call("events", { type: "InvoiceSent" }) as { events: unknown[] }).events).toHaveLength(1);
    expect((call("events", { type: "Nothing" }) as { events: unknown[] }).events).toHaveLength(0);
  });

  it("filters the outbox by event type", () => {
    const { call } = session();
    call("run", { action: "Invoice.send", record: draft, actor: billing });

    expect((call("outbox", { type: "InvoiceSent" }) as { entries: Entry[] }).entries).toHaveLength(1);
    expect((call("outbox", { type: "InvoicePaid" }) as { entries: Entry[] }).entries).toHaveLength(0);
  });

  it("refuses to acknowledge an entry it never queued", () => {
    const { raw } = session();
    expect(raw("ack", { id: "outbox-does-not-exist" }).error?.code).toBe(-32602);
    expect(raw("nack", { id: "outbox-does-not-exist" }).error?.code).toBe(-32602);
  });

  it("orders the outbox oldest first", () => {
    const { call } = session();
    call("run", { action: "Invoice.send", record: draft, actor: billing });
    call("run", {
      action: "Invoice.send",
      record: { ...draft, id: "inv-outbox-2", number: "INV-OUTBOX-2" },
      actor: billing,
    });

    const pending = call("outbox") as { entries: Entry[] };
    expect(pending.entries).toHaveLength(2);
    expect(pending.entries[0]?.event.type).toBe("InvoiceSent");
  });
});

describe("a session snapshot", () => {
  it("counts what is stored, pending, and claimed", () => {
    const store = new SessionStore();
    store.put("Invoice", draft);
    store.claim("evt-1:policy");
    store.applyEffects(
      "Invoice",
      [],
      [
        {
          specversion: "1.0" as const,
          id: "evt-2",
          source: "kerangka/test",
          type: "InvoiceSent",
          time: "2026-09-30T00:00:00.000Z",
          datacontenttype: "application/json" as const,
          data: {},
        },
      ]
    );

    expect(store.snapshot()).toEqual({
      entities: { Invoice: 1 },
      events: 1,
      pending: 1,
      claims: ["evt-1:policy"],
    });
  });
});
