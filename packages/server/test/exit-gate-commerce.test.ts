import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "@kerangka/compiler";
import { loadEngine } from "@kerangka/engine-ts";
import { createJsonRpcDispatcher, serveStdio } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const commercePath = path.resolve(__dirname, "../../../examples/commerce/kerangka.json");
const commerceSource = fs.readFileSync(commercePath, "utf-8");

/**
 * PLAN.md §19, Phase 2 exit gate: commerce runs as a modular monolith with policies
 * across contexts. Driven through the same stdio JSON-RPC a non-JavaScript client uses,
 * so the sidecar contract is what is proven, not an in-process shortcut.
 */
describe("Phase 2 exit gate: commerce across the sidecar", () => {
  it("places an order and runs both contexts' policies over JSON-RPC", () => {
    const engine = loadEngine(compile(commerceSource, { sourcePath: commercePath }));
    const dispatch = createJsonRpcDispatcher(engine);

    const call = (method: string, params: Record<string, unknown>): any => {
      const line = dispatch(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }));
      expect(line).not.toBeNull();
      const res = JSON.parse(line as string);
      expect(res.error, `${method} failed: ${line}`).toBeUndefined();
      return res.result;
    };

    const order = {
      id: "o-1",
      orderNumber: "ORD-1",
      customerId: "c-1",
      status: "draft",
      lines: [{ qty: 2, price: 100 }],
    };

    const placed = call("run", {
      action: "Order.place",
      record: order,
      actor: { id: "c-1", roles: ["customer"] },
    });
    expect(placed.ok).toBe(true);
    expect(placed.record.status).toBe("placed");
    expect(placed.events[0].type).toBe("OrderPlaced");
    // The event carries values from the record, not the names of its fields.
    expect(placed.events[0].data).toEqual({
      orderId: "o-1",
      customerId: "c-1",
      amount: 200,
    });

    const reaction = call("react", { event: placed.events[0] });
    expect(reaction.invocations).toHaveLength(2);
    expect(reaction.invocations.map((i: any) => i.action).sort()).toEqual([
      "Invoice.create",
      "StockReservation.create",
    ]);

    // A create action has no aggregate yet: the policy bindings are its record.
    const system = { id: "policy-runner", roles: ["system"] };
    const results = reaction.invocations.map((invocation: any) =>
      call("run", { action: invocation.action, record: invocation.input, actor: system }),
    );

    const invoice = results.find(
      (_: unknown, i: number) => reaction.invocations[i].action === "Invoice.create",
    );
    const reservation = results.find(
      (_: unknown, i: number) => reaction.invocations[i].action === "StockReservation.create",
    );

    expect(invoice.ok, `Invoice.create: ${invoice.code ?? ""}`).toBe(true);
    expect(invoice.record.invoiceNumber).toBe("INV-o-1");
    expect(invoice.record.amountDue).toBe(200);

    expect(reservation.ok, `StockReservation.create: ${reservation.code ?? ""}`).toBe(true);
    expect(reservation.record.orderId).toBe("o-1");
    expect(reservation.record.status).toBe("active");
  });

  it("serves the same flow over a stdio stream and exits when the input ends", async () => {
    const engine = loadEngine(compile(commerceSource, { sourcePath: commercePath }));

    const { PassThrough } = await import("node:stream");
    const input = new PassThrough();
    const output = new PassThrough();
    const logs: string[] = [];
    const written: string[] = [];

    output.on("data", (chunk: Buffer) => written.push(chunk.toString()));
    input.on("data", () => {});

    const serving = serveStdio(engine, {
      input,
      output,
      log: (message) => logs.push(message),
    });

    input.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "describe", params: {} })}\n`,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(written).toHaveLength(1);
    const described = JSON.parse(written[0] as string);
    expect(described.result.entities).toEqual(
      expect.arrayContaining(["Order", "Invoice", "StockReservation"]),
    );

    input.end();
    await serving;

    expect(logs.join("\n")).toContain("stdio JSON-RPC closed");
  });
});
