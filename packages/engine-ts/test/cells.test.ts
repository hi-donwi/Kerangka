import { describe, expect, it } from "vitest";
import { compile } from "@kerangka/compiler";
import { loadEngine } from "../src/index.js";

/**
 * spec/semantics/cells.md: one resolution rule for every computed cell. A cell is
 * computed only when it unambiguously compiles to K1 and evaluates to a non-null
 * value; otherwise it is a literal, exactly as written.
 */
function engineFrom(doc: Record<string, unknown>) {
  return loadEngine(compile(JSON.parse(JSON.stringify(doc))));
}

const orderDoc = (then: unknown[], actions?: unknown) => ({
  kerangka: "0.1",
  app: "cells",
  entities: {
    Order: {
      fields: {
        id: "string!",
        amount: "decimal(12,2)!",
        status: "string! = 'draft'",
        label: "string",
      },
      workflow: {
        field: "status",
        states: ["draft", "sent"],
        initial: "draft",
        transitions: { send: { from: "draft", to: "sent", then } },
      },
      ...(actions ? { actions } : {}),
    },
  },
});

const actor = { id: "u-1", roles: ["ops"] };

describe("statement cells", () => {
  it("keeps a plain word a literal", () => {
    const engine = engineFrom(orderDoc([{ set: { status: "sent" } }]));
    const result = engine.run("Order", "send", { id: "o-1", amount: 10, status: "draft" }, {}, actor);

    expect(result.ok).toBe(true);
    expect(result.record?.status).toBe("sent");
  });

  it("strips quotes so a value can be written explicitly", () => {
    const engine = engineFrom(orderDoc([{ set: { status: "'draft'" } }]));
    const result = engine.run("Order", "send", { id: "o-1", amount: 10, status: "draft" }, {}, actor);

    expect(result.record?.status).toBe("draft");
  });

  it("computes a cell that compiles to a call", () => {
    const engine = engineFrom(orderDoc([{ set: { label: "concat(id, '-ok')" } }]));
    const result = engine.run("Order", "send", { id: "o-1", amount: 10, status: "draft" }, {}, actor);

    expect(result.record?.label).toBe("o-1-ok");
  });

  it("computes an operation cell written as an object", () => {
    const engine = engineFrom(
      orderDoc([{ set: { amount: { operator: "multiply", args: [{ path: "amount" }, 1.2] } } }]),
    );
    const result = engine.run("Order", "send", { id: "o-1", amount: 10, status: "draft" }, {}, actor);

    expect(Number(result.record?.amount)).toBeCloseTo(12, 5);
  });

  it("falls back to the written text when a path cannot resolve", () => {
    // A typo must neither erase the field nor invent a value.
    const engine = engineFrom(orderDoc([{ set: { label: "concat(ttoal, 'x')" } }]));
    const result = engine.run("Order", "send", { id: "o-1", amount: 10, status: "draft" }, {}, actor);

    expect(result.record?.label).toBe("concat(ttoal, 'x')");
  });

  it("aborts on a declared failure without a patch", () => {
    const engine = engineFrom(
      orderDoc([
        { set: { label: "attempted" } },
        { fail: { code: "CREDIT_HOLD", message: "Customer is on credit hold" } },
      ]),
    );
    const result = engine.run("Order", "send", { id: "o-1", amount: 10, status: "draft" }, {}, actor);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("CREDIT_HOLD");
    expect(result.record?.label).toBeUndefined();
  });

  it("resolves action run cells with the same rule", () => {
    // The compiler already refuses a cell that reads an undeclared input.
    const doc = orderDoc([]);
    const engine = engineFrom({
      ...doc,
      entities: {
        Order: {
          ...(doc.entities as Record<string, Record<string, unknown>>).Order,
          actions: {
            label: {
              roles: ["ops"],
              input: { prefix: "string" },
              run: { label: "concat(input.prefix, id)", status: "'sent'" },
            },
          },
        },
      },
    });
    const result = engine.run("Order", "label", { id: "o-9", amount: 5, status: "draft" }, {
      prefix: "so-",
    }, actor);

    expect(result.ok).toBe(true);
    expect(result.record?.label).toBe("so-o-9");
    expect(result.record?.status).toBe("sent");
  });
});

describe("decision-table output cells", () => {
  const tableDoc = (row: Record<string, unknown>, output: { name: string; type: string }) => ({
    kerangka: "0.1",
    app: "cells-decision",
    decisions: {
      approverRouting: {
        hitPolicy: "first",
        inputs: [{ name: "amount", type: "decimal" }],
        outputs: [output],
        rows: [row],
      },
    },
    entities: {},
  });

  it("computes an output cell from the row input", () => {
    const engine = engineFrom(
      tableDoc({ amount: ">= 1000", approver: "concat('director-', amount)" }, {
        name: "approver",
        type: "string",
      }),
    );

    const result = engine.decide("approverRouting", { amount: 2500 });
    expect(result.matched).toBe(true);
    expect(result.outputs).toEqual({ approver: "director-2500" });
  });

  it("keeps a plain output word a literal", () => {
    const engine = engineFrom(
      tableDoc({ amount: ">= 1", approver: "auto" }, { name: "approver", type: "string" }),
    );

    const result = engine.decide("approverRouting", { amount: 10 });
    expect(result.outputs).toEqual({ approver: "auto" });
  });

  it("resolves a declared operation object", () => {
    const engine = engineFrom(
      tableDoc(
        { amount: ">= 1", rate: { operator: "multiply", args: [{ path: "amount" }, 0.1] } },
        { name: "rate", type: "decimal" },
      ),
    );

    const result = engine.decide("approverRouting", { amount: 300 });
    expect(Number((result.outputs as Record<string, unknown>).rate)).toBeCloseTo(30, 5);
  });
});
