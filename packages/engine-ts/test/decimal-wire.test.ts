/**
 * A decimal travels as a JSON string ("150.00", PLAN.md §9.1, spec/semantics/numbers.md §2.1),
 * and K1 compares and computes numbers. Before this, the engine handed the string straight to
 * the evaluator: `price > 0` was false for "150.00" (a guard that failed closed on every
 * spec-encoded record), and `>= 0` never ran on "-5.00" (a constraint that failed open).
 */

import { describe, expect, it } from "vitest";
import { compile } from "@kerangka/compiler";
import { Engine } from "../src/index.js";

const engineFor = (doc: Record<string, unknown>) =>
  new Engine(compile({ kerangka: "0.1", app: "decimals", ...doc } as never));

const invoicing = () =>
  engineFor({
    types: { Fee: { fields: { amount: "decimal(12,2)!", currency: "string!" } } },
    entities: {
      Invoice: {
        fields: {
          status: "enum(draft, issued) = draft",
          lines: "list(Line)",
          discount: "decimal(12,2) >= 0",
          fee: "Fee",
          total: { type: "decimal(12,2)", compute: "sum(lines, qty * price) - coalesce(discount, 0)" },
        },
        workflow: {
          transitions: {
            issue: { from: "draft", to: "issued", when: "total > 0" },
          },
        },
        actions: {
          applyDiscount: {
            input: { amount: "decimal(12,2)!" },
            when: "input.amount <= total",
            run: { discount: "input.amount" },
          },
          chargeFee: {
            when: "fee.amount > 0",
            run: { status: "'issued'" },
          },
        },
      },
      Line: { embedded: true, fields: { qty: "int! >= 1", price: "decimal(12,2)! >= 0" } },
    },
  });

const draft = (overrides: Record<string, unknown> = {}): Record<string, unknown> & { lines: unknown[] } => ({
  status: "draft",
  lines: [{ qty: 2, price: "150.00" }],
  ...overrides,
});

describe("the engine reads the decimal wire encoding", () => {
  it("computes over decimal strings inside embedded lines, so a guard on the total passes", () => {
    const engine = invoicing();
    expect(engine.compute("Invoice", draft()).total).toBe(300);
    const result = engine.run("Invoice.issue", draft());
    expect(result.ok).toBe(true);
    expect(result.record?.status).toBe("issued");
  });

  it("subtracts a decimal string field from a decimal string sum", () => {
    expect(invoicing().compute("Invoice", draft({ discount: "20.50" })).total).toBe(279.5);
  });

  it("reads a decimal string inside a value type", () => {
    const result = invoicing().run("Invoice.chargeFee", draft({ fee: { amount: "2.50", currency: "USD" } }));
    expect(result.ok).toBe(true);
  });

  it("reads a decimal string in an action input", () => {
    const engine = invoicing();
    const ok = engine.run("Invoice.applyDiscount", draft(), { amount: "50.00" });
    expect(ok.ok).toBe(true);
    expect(ok.record?.discount).toBe(50);
    expect(engine.run("Invoice.applyDiscount", draft(), { amount: "999.00" }).ok).toBe(false);
  });

  it("still takes plain numbers, which existing callers send", () => {
    const result = invoicing().run("Invoice.issue", draft({ lines: [{ qty: 1, price: 10 }] }));
    expect(result.ok).toBe(true);
  });

  it("holds a decimal string to its declared minimum", () => {
    const result = invoicing().validate("Invoice", draft({ discount: "-5.00" }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "MIN_CONSTRAINT", field: "discount" })]));
  });

  it("computes a negative line into the total, so the guard refuses it", () => {
    const result = invoicing().run("Invoice.issue", draft({ lines: [{ qty: 1, price: "-1.00" }] }));
    expect(result.ok).toBe(false);
  });

  it("refuses a value in a decimal field that is not a number, instead of skipping its checks", () => {
    const result = invoicing().validate("Invoice", draft({ discount: "ten" }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "INVALID_DECIMAL", field: "discount" })]));
  });

  it("does not modify the record it was given", () => {
    const record = draft({ discount: "20.50" });
    invoicing().run("Invoice.issue", record);
    expect(record.discount).toBe("20.50");
    expect(record.lines[0]).toEqual({ qty: 2, price: "150.00" });
  });
});
