import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "@kerangka/compiler";
import { loadEngine } from "@kerangka/engine-ts";
import { createJsonRpcDispatcher, SessionStore } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const commercePath = path.resolve(__dirname, "../../../examples/commerce/kerangka.json");
const commerceSource = fs.readFileSync(commercePath, "utf-8");

/**
 * The two gaps the previous run left: `react` had no host loop, and an aggregate
 * created by a statement was never read back. `handle` closes both, with the
 * idempotency PLAN.md §7.7 asks for.
 */
function commerceSession() {
  const engine = loadEngine(compile(commerceSource, { sourcePath: commercePath }));
  const store = new SessionStore();
  const dispatch = createJsonRpcDispatcher(engine, store);
  let id = 0;
  const call = (method: string, params: Record<string, unknown> = {}) => {
    id += 1;
    const line = dispatch(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    const res = JSON.parse(line as string) as { result?: unknown; error?: { message: string } };
    expect(res.error, `${method}: ${line}`).toBeUndefined();
    return res.result as never;
  };
  return { store, call };
}

const customer = { id: "c-1", roles: ["customer"] };
const system = { id: "policy-runner", roles: ["system"] };

function placeOrder(call: (m: string, p?: Record<string, unknown>) => never) {
  const placed = call("run", {
    action: "Order.place",
    record: { id: "o-1", orderNumber: "ORD-1", customerId: "c-1", status: "draft", lines: [{ qty: 2, price: 100 }] },
    actor: customer,
  }) as { ok: boolean; events: { type: string; data: Record<string, unknown> }[] };
  expect(placed.ok).toBe(true);
  return placed.events[0]!;
}

describe("handle: the host loop for policies", () => {
  it("runs every policy an event triggers and stores what they persist", () => {
    const { call } = commerceSession();
    const event = placeOrder(call);

    const handled = call("handle", { event, actor: system }) as {
      handled: boolean;
      runs: { action: string; result: { ok: boolean; record: Record<string, unknown> } }[];
    };

    expect(handled.handled).toBe(true);
    expect(handled.runs.map((r) => r.action).sort()).toEqual([
      "Invoice.create",
      "StockReservation.create",
    ]);
    expect(handled.runs.every((r) => r.result.ok)).toBe(true);

    const invoices = call("list", { entity: "Invoice" }) as { records: Record<string, unknown>[] };
    expect(invoices.records).toHaveLength(1);
    expect(invoices.records[0]?.invoiceNumber).toBe("INV-o-1");
    expect(invoices.records[0]?.amountDue).toBe(200);

    const reservations = call("list", { entity: "StockReservation" }) as {
      records: Record<string, unknown>[];
    };
    expect(reservations.records).toHaveLength(1);
    expect(reservations.records[0]?.status).toBe("active");
  });

  it("reads a created aggregate back by id", () => {
    const { call } = commerceSession();
    const event = placeOrder(call);
    call("handle", { event, actor: system });

    const listed = call("list", { entity: "Invoice" }) as { records: { id?: string }[] };
    const id = listed.records[0]?.id;
    expect(typeof id).toBe("string");

    const fetched = call("get", { entity: "Invoice", id: id as string }) as {
      record: { invoiceNumber: string } | null;
    };
    expect(fetched.record?.invoiceNumber).toBe("INV-o-1");
  });

  it("skips a replayed event instead of running its policies twice", () => {
    const { call } = commerceSession();
    const event = placeOrder(call);

    call("handle", { event, actor: system });
    const replayed = call("handle", { event, actor: system }) as {
      runs: unknown[];
      skipped: string[];
      invocations: unknown[];
    };

    expect(replayed.invocations).toHaveLength(2);
    expect(replayed.runs).toHaveLength(0);
    expect(replayed.skipped.map((p) => p.split(".").pop()).sort()).toEqual([
      "onOrderPlaced",
      "onOrderPlaced",
    ]);

    const invoices = call("list", { entity: "Invoice" }) as { records: unknown[] };
    expect(invoices.records).toHaveLength(1);
  });

  it("gives a different event id a fresh claim", () => {
    const { call } = commerceSession();
    const first = placeOrder(call);
    call("handle", { event: first, actor: system });

    const second = { ...first, id: "evt-2", data: { ...first.data, orderId: "o-2" } };
    const handled = call("handle", { event: second, actor: system }) as { runs: unknown[] };
    expect(handled.runs).toHaveLength(2);

    const invoices = call("list", { entity: "Invoice" }) as { records: unknown[] };
    expect(invoices.records).toHaveLength(2);
  });

  it("reports a policy that refused without claiming success for the others", () => {
    const { call } = commerceSession();
    const event = placeOrder(call);

    // No actor: neither `system` action is authorised, so both must fail loudly.
    const handled = call("handle", { event }) as {
      runs: unknown[];
      failed: { action: string; code?: string }[];
    };

    expect(handled.runs).toHaveLength(0);
    expect(handled.failed).toHaveLength(2);
    expect(handled.failed.map((f) => f.code).sort()).toEqual(["PERMISSION_DENIED", "PERMISSION_DENIED"]);

    const invoices = call("list", { entity: "Invoice" }) as { records: unknown[] };
    expect(invoices.records).toHaveLength(0);
  });

  it("leaves the claims visible for inspection", () => {
    const { call } = commerceSession();
    const event = placeOrder(call);
    call("handle", { event, actor: system });

    const claims = call("claims") as { claims: string[] };
    expect(claims.claims).toHaveLength(2);
    expect(claims.claims.every((c) => c.includes("onOrderPlaced"))).toBe(true);
    expect(new Set(claims.claims).size).toBe(2);
  });
});
