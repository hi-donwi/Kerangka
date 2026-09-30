import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "@kerangka/compiler";
import { loadEngine } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.resolve(__dirname, "../../../examples");

const commercePath = path.join(examplesDir, "commerce/kerangka.json");
const commerceRaw = fs.readFileSync(commercePath, "utf8");

const billingPath = path.join(examplesDir, "leave-request.kerangka.json");

function commerceEngine() {
  return loadEngine(compile(commerceRaw, { sourcePath: commercePath }));
}

describe("Policies across contexts", () => {
  it("keeps every context policy when two contexts name theirs the same", () => {
    const kir = compile(commerceRaw, { sourcePath: commercePath });

    const listening = Object.values(kir.policies ?? {}).filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (p: any) => p.on === "orders.OrderPlaced",
    );

    expect(listening).toHaveLength(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(listening.map((p: any) => p.run).sort()).toEqual([
      "Invoice.create",
      "StockReservation.create",
    ]);
  });

  it("reacts to an event a policy names with its context prefix", () => {
    const engine = commerceEngine();

    const reaction = engine.react({
      type: "OrderPlaced",
      data: { orderId: "o-1", customerId: "c-1", amount: 200 },
    });

    expect(reaction.handled).toBe(true);
    expect(reaction.invocations).toHaveLength(2);
    expect(reaction.invocations.map((i) => i.action).sort()).toEqual([
      "Invoice.create",
      "StockReservation.create",
    ]);
  });

  it("maps the policy `with` block into the action input", () => {
    const engine = commerceEngine();

    const reaction = engine.react({
      type: "OrderPlaced",
      data: { orderId: "o-1", customerId: "c-1", amount: 200 },
    });

    const invoice = reaction.invocations.find((i) => i.action === "Invoice.create");
    expect(invoice?.input).toEqual({
      invoiceNumber: "INV-o-1",
      orderId: "o-1",
      customerId: "c-1",
      amountDue: 200,
      status: "issued",
    });

    const reservation = reaction.invocations.find((i) => i.action === "StockReservation.create");
    expect(reservation?.input?.orderId).toBe("o-1");
    expect(reservation?.input?.status).toBe("active");
  });

  it("ignores an event no policy listens to", () => {
    const engine = commerceEngine();

    const reaction = engine.react({ type: "SomethingElse", data: {} });
    expect(reaction.handled).toBe(false);
    expect(reaction.invocations).toHaveLength(0);
  });

  it("carries an idempotency key per policy invocation", () => {
    const engine = commerceEngine();

    const reaction = engine.react({
      type: "OrderPlaced",
      id: "evt-42",
      data: { orderId: "o-1", customerId: "c-1", amount: 200 },
    });

    const keys = reaction.invocations.map((i) => i.idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(typeof key).toBe("string");
      expect(key).toContain("evt-42");
    }
  });
});

describe("Commerce as a modular monolith", () => {
  it("places an order and runs both contexts' policies", () => {
    const engine = commerceEngine();
    const actor = { id: "sys", roles: ["system"] };

    const order = {
      id: "o-1",
      orderNumber: "ORD-1",
      customerId: "c-1",
      status: "draft",
      lines: [{ qty: 2, price: 100 }],
    };

    const placed = engine.run("Order.place", order, {}, actor);
    expect(placed.ok).toBe(true);
    expect(placed.record?.status).toBe("placed");
    expect(placed.events?.[0]?.type).toBe("OrderPlaced");

    const reaction = engine.react(placed.events![0]!);
    expect(reaction.invocations).toHaveLength(2);

    // A `create` action has no existing aggregate: the policy bindings are its record,
    // exactly as a REST POST body would be.
    const results = reaction.invocations.map((invocation) =>
      engine.run(invocation.action, invocation.input ?? {}, {}, actor),
    );

    const invoice = results.find((_, i) => reaction.invocations[i]!.action === "Invoice.create");
    const reservation = results.find(
      (_, i) => reaction.invocations[i]!.action === "StockReservation.create",
    );

    expect(invoice?.ok, `Invoice.create: ${invoice?.code ?? ""}`).toBe(true);
    expect(reservation?.ok, `StockReservation.create: ${reservation?.code ?? ""}`).toBe(true);
    expect(invoice?.record?.invoiceNumber).toBe("INV-o-1");
    expect(reservation?.record?.orderId).toBe("o-1");
  });
});

describe("Policy input through a single-context document", () => {
  it("maps `with` for a plain document policy", () => {
    const engine = loadEngine(
      compile(
        JSON.stringify({
          kerangka: "0.1",
          app: "policy-input",
          events: { OrderPlaced: { orderId: "uuid!" } },
          entities: {
            Invoice: {
              fields: {
                orderId: "uuid!",
                invoiceNumber: "string!",
                status: "enum(issued, paid) = issued",
              },
              actions: {
                create: { roles: ["system"] },
              },
            },
          },
          policies: {
            onOrderPlaced: {
              on: "OrderPlaced",
              run: "Invoice.create",
              with: { orderId: "event.data.orderId", invoiceNumber: "concat('INV-', event.data.orderId)" },
            },
          },
        }),
        { sourcePath: "policy-input" },
      ),
    );

    const reaction = engine.react({ type: "OrderPlaced", data: { orderId: "o-9" } });
    expect(reaction.invocations).toHaveLength(1);
    expect(reaction.invocations[0]!.input).toEqual({
      orderId: "o-9",
      invoiceNumber: "INV-o-9",
    });
  });

  it("still reads a programmatic policy that uses `input`", () => {
    const engine = loadEngine({
      events: { OrderPlaced: {} },
      entities: {
        Invoice: {
          fields: { orderId: "uuid!" },
          actions: { create: { run: {}, roles: ["system"] } },
        },
      },
      policies: {
        onOrderPlaced: {
          on: "OrderPlaced",
          run: "Invoice.create",
          input: { orderId: "o-7" },
        },
      },
    });

    const reaction = engine.react({ type: "OrderPlaced", data: {} });
    expect(reaction.invocations[0]!.input).toEqual({ orderId: "o-7" });
  });

  it("resolves a policy target from the event", () => {
    const engine = loadEngine(
      compile(
        JSON.stringify({
          kerangka: "0.1",
          app: "policy-target",
          events: { InvoicePaid: { invoiceId: "uuid!" } },
          entities: {
            Invoice: {
              fields: { status: "enum(issued, paid) = issued" },
              actions: { markPaid: { roles: ["system"] } },
            },
          },
          policies: {
            onPaid: {
              on: "InvoicePaid",
              run: "Invoice.markPaid",
              target: "event.data.invoiceId",
            },
          },
        }),
        { sourcePath: "policy-target" },
      ),
    );

    const reaction = engine.react({ type: "InvoicePaid", data: { invoiceId: "inv-3" } });
    expect(reaction.invocations[0]!.targetId).toBe("inv-3");
  });
});

describe("Regression: a single-context policy still fires", () => {
  it("leave-request compiles and reacts without policies", () => {
    const raw = fs.readFileSync(billingPath, "utf8");
    const engine = loadEngine(compile(raw));
    expect(engine.decide("approverRouting", { days: 2 }).matched).toBe(true);
  });
});
