import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compile } from "@kerangka/compiler";
import { loadEngine } from "@kerangka/engine-ts";
import { createJsonRpcDispatcher, SessionStore } from "../src/index.js";

/**
 * A `call`, a notification, and a timer are the host's work. The sidecar cannot
 * perform them — it cannot know what "delivered" means — but it must not lose them
 * either. They are queued in the same commit as the write that caused them, and a
 * dispatch that fails leaves the effect waiting to be retried.
 *
 * The invoicing example's `send` transition calls `sendInvoiceEmail` with the invoice
 * id, which is the case that used to arrive empty.
 */
const invoicing = loadEngine(
  compile(readFileSync(resolve(__dirname, "../../../examples/invoicing.kerangka.json"), "utf8"))
);

const billing = { id: "u-1", roles: ["billing"] };
const draft = {
  id: "inv-effect-1",
  number: "INV-EFFECT-1",
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

type EffectEntry = {
  id: string;
  effect: { type: string; extension?: string; input?: Record<string, unknown> };
  attempts: number;
  state: string;
  lastError?: string;
};

const send = (call: (method: string, params?: Record<string, unknown>) => never) =>
  call("run", { action: "Invoice.send", record: draft, actor: billing }) as unknown as {
    commit: { persisted: number; queuedEffects: number };
  };

describe("a queued host effect", () => {
  it("carries the declared argument, which the spec writes as `with`", () => {
    const { call } = session();
    send(call);

    const entries = call("pendingEffects", {}) as unknown as { entries: EffectEntry[] };
    expect(entries.entries).toHaveLength(1);
    expect(entries.entries[0]!.effect).toMatchObject({
      type: "call",
      extension: "sendInvoiceEmail",
      // The cell `id` resolved against the record. Before the fix this was {}.
      input: { invoice: "inv-effect-1" },
    });
  });

  it("is queued in the same commit as the write that caused it", () => {
    const { store, call } = session();
    const result = send(call);

    expect(result.commit).toMatchObject({ persisted: 1, queuedEffects: 1 });
    expect(store.get("Invoice", "inv-effect-1")?.status).toBe("sent");
    expect(store.pendingEffects()).toHaveLength(1);
  });

  it("is not queued when the commit fails", () => {
    const store = new SessionStore();
    // A persist effect that cannot be stored aborts the whole commit, and the effect
    // that came with it must not survive it.
    expect(() =>
      store.applyEffects(
        "Invoice",
        [
          { type: "call", extension: "sendInvoiceEmail", input: {} },
          { type: "persist", entity: "Invoice", record: { number: "no id" } },
        ] as never,
        []
      )
    ).toThrow(/no string 'id'/);

    expect(store.pendingEffects()).toHaveLength(0);
  });

  it("stays pending after a failed dispatch, and is counted", () => {
    const { call } = session();
    send(call);
    const entry = (call("pendingEffects", {}) as unknown as { entries: EffectEntry[] }).entries[0]!;

    const nacked = (call("nackEffect", { id: entry.id, error: "smtp down" }) as unknown as {
      entry: EffectEntry;
    }).entry;
    expect(nacked.state).toBe("pending");
    expect(nacked.attempts).toBe(1);
    expect(nacked.lastError).toBe("smtp down");
    expect((call("pendingEffects", {}) as unknown as { entries: EffectEntry[] }).entries).toHaveLength(1);

    const acked = (call("ackEffect", { id: entry.id }) as unknown as { entry: EffectEntry }).entry;
    expect(acked.state).toBe("delivered");
    expect((call("pendingEffects", {}) as unknown as { entries: EffectEntry[] }).entries).toHaveLength(0);
  });

  it("does not perform the effect itself", () => {
    const { store } = session();
    store.applyEffects(
      "Invoice",
      [{ type: "call", extension: "sendInvoiceEmail", input: { invoice: "x" } }] as never,
      []
    );

    // It is queued and untouched: no dispatch, no connector, no state change.
    expect(store.pendingEffects()[0]!.effect).toMatchObject({ extension: "sendInvoiceEmail" });
    expect(store.get("Invoice", "x")).toBeNull();
  });

  it("can be listed by type", () => {
    const store = new SessionStore();
    store.applyEffects(
      "Invoice",
      [
        { type: "call", extension: "sendInvoiceEmail", input: {} },
        { type: "timer", at: "2026-10-01T00:00:00.000Z", action: "Invoice.remind", target: "inv-1" },
      ] as never,
      []
    );

    expect(store.pendingEffects("timer")).toHaveLength(1);
    expect(store.pendingEffects("call")).toHaveLength(1);
    expect(store.pendingEffects()).toHaveLength(2);
  });

  it("says so when the effect is not there, rather than reporting success", () => {
    const { raw } = session();

    for (const method of ["ackEffect", "nackEffect"]) {
      const response = raw(method, { id: "effect-9-9" });
      expect(response.error?.code).toBe(-32602);
    }
  });

  it("survives nothing when the session is cleared", () => {
    const { store, call } = session();
    send(call);
    call("clear", {});

    expect(store.pendingEffects()).toHaveLength(0);
    expect(store.pending()).toHaveLength(0);
  });
});
