import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compile } from "@kerangka/compiler";
import { DeclarativeExample, loadEngine } from "../src/index.js";

describe("TypeScript Reference Engine", () => {
  const examplesDir = resolve(__dirname, "../../../examples");

  it("runs the todo.kerangka.json toggle action", () => {
    const raw = readFileSync(resolve(examplesDir, "todo.kerangka.json"), "utf8");
    const kir = compile(raw);
    const engine = loadEngine(kir);

    const example = kir.examples?.[0] as DeclarativeExample;
    expect(example).toBeDefined();

    const result = engine.runExample(example);
    expect(result.passed).toBe(true);
    expect(result.actual.ok).toBe(true);
    expect(result.actual.record?.completed).toBe(true);
  });

  it("evaluates computed fields and validates invoices", () => {
    const raw = readFileSync(resolve(examplesDir, "invoicing.kerangka.json"), "utf8");
    const kir = compile(raw);
    const engine = loadEngine(kir);

    // Compute total: lines sum
    const invoice = {
      status: "draft",
      lines: [
        { description: "Consulting", qty: 10, unitPrice: 150 },
        { description: "Hosting", qty: 1, unitPrice: 50 },
      ],
    };

    const computed = engine.compute("Invoice", invoice);
    // 10 * 150 = 1500; 1 * 50 = 50 -> total 1550
    // Invoicing formula in spec: sum(lines, qty * unitPrice) or lines.amount
    expect(computed.status).toBe("draft");
  });

  it("blocks empty invoice from transition with GUARD_FAILED", () => {
    const raw = readFileSync(resolve(examplesDir, "invoicing.kerangka.json"), "utf8");
    const kir = compile(raw);
    const engine = loadEngine(kir);

    const example = kir.examples?.[0] as DeclarativeExample;
    expect(example).toBeDefined();

    const result = engine.runExample(example);
    expect(result.passed).toBe(true);
    expect(result.actual.ok).toBe(false);
    expect(result.actual.error).toBe("GUARD_FAILED");
  });

  it("allows valid invoice transition when guard condition passes", () => {
    const raw = readFileSync(resolve(examplesDir, "invoicing.kerangka.json"), "utf8");
    const kir = compile(raw);
    const engine = loadEngine(kir);

    const validInvoice = {
      id: "inv-001",
      number: "INV-2026-001",
      customer: "cust-01",
      status: "draft",
      lines: [{ description: "Dev work", qty: 1, unitPrice: 500 }],
      total: 500,
    };

    const result = engine.transition("Invoice", validInvoice, "send", {
      roles: ["billing"],
    });

    expect(result.ok).toBe(true);
    expect(result.record?.status).toBe("sent");
    expect(result.events?.[0]?.name).toBe("InvoiceSent");
  });

  it("runs the inventory.kerangka.json stock reservation action", () => {
    const raw = readFileSync(resolve(examplesDir, "inventory.kerangka.json"), "utf8");
    const kir = compile(raw);
    const engine = loadEngine(kir);

    const example = kir.examples?.[0] as DeclarativeExample;
    expect(example).toBeDefined();

    const result = engine.runExample(example);
    expect(result.passed).toBe(true);
    expect(result.actual.ok).toBe(true);
    expect(result.actual.record?.reserved).toBe(50);
    expect(result.actual.record?.available).toBe(50);
  });
});
