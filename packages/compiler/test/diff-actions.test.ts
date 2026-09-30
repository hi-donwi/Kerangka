import { describe, expect, it } from "vitest";
import { compile, diffModels } from "@kerangka/compiler";

/**
 * An action is the last contract the model publishes: what a client is allowed to do,
 * with which input, and what happens when it does. Every change that narrows it is
 * breaking, and the ones that break silently — a role that loses access, an input that
 * gains a required field — are the reason this exists.
 */
const model = (actions: Record<string, unknown> | undefined, roles?: string[]) =>
  compile(
    JSON.stringify({
      kerangka: "0.1",
      app: "contracts",
      ...(roles ? { roles } : {}),
      entities: {
        Order: { fields: { id: "string!", total: "decimal(12,2)" }, ...(actions ? { actions } : {}) },
      },
    })
  );

const place = (spec: Record<string, unknown>) => ({ placeOrder: spec });

const diff = (before: ReturnType<typeof model>, after: ReturnType<typeof model>) =>
  diffModels(before, after);

const buyer = { roles: ["buyer"], input: { quantity: "int!" } };
const admin = { roles: ["admin"], input: { quantity: "int!" } };

describe("action changes", () => {
  it("removing an action is breaking, and says there is no deprecation", () => {
    const result = diff(model(place(buyer)), model({}));

    const change = result.changes.find((c) => c.path === "entities.Order.actions.placeOrder");
    expect(change?.classification).toBe("breaking");
    expect(change?.hint).toContain("no deprecation");
  });

  it("adding an action is additive", () => {
    const result = diff(model({}), model(place(buyer)));

    expect(
      result.changes.find((c) => c.path === "entities.Order.actions.placeOrder")?.classification
    ).toBe("additive");
    expect(result.hasBreakingChanges).toBe(false);
  });

  it("taking a role away is breaking: the call still compiles and returns a denial", () => {
    const wide = { roles: ["buyer", "admin"], input: { quantity: "int!" } };
    const result = diff(model(place(wide)), model(place(admin)));

    const change = result.changes.find((c) => c.path === "entities.Order.actions.placeOrder.roles");
    expect(change?.classification).toBe("breaking");
    expect(change?.message).toContain("'buyer' lost access");
    expect(change?.hint).toContain("Widen the roles first");
  });

  it("granting a role is compatible", () => {
    const result = diff(model(place(admin)), model(place({ roles: ["admin", "buyer"], input: { quantity: "int!" } })));

    expect(
      result.changes.find((c) => c.path === "entities.Order.actions.placeOrder.roles")?.classification
    ).toBe("compatible");
    expect(result.hasBreakingChanges).toBe(false);
  });

  it("naming an undeclared role is breaking, because it denies everyone", () => {
    const open = { roles: ["admin", "auditor"], input: {} };
    const result = diff(model(place({ roles: ["admin"], input: {} }), ["admin"]), model(place(open), ["admin"]));

    const change = result.changes.find(
      (c) => c.path === "entities.Order.actions.placeOrder.roles.auditor"
    );
    expect(change?.classification).toBe("breaking");
    expect(change?.hint).toContain("denies everyone");
  });

  it("adding a required input field without a default is breaking", () => {
    const wider = { roles: ["buyer"], input: { quantity: "int!", note: "string!" } };
    const result = diff(model(place(buyer)), model(place(wider)));

    const change = result.changes.find((c) => c.path === "entities.Order.actions.placeOrder.input.note");
    expect(change?.classification).toBe("breaking");
    expect(change?.hint).toContain("Add it optional first");
  });

  it("adding an optional input field is additive", () => {
    const wider = { roles: ["buyer"], input: { quantity: "int!", note: "string" } };
    const result = diff(model(place(buyer)), model(place(wider)));

    expect(
      result.changes.find((c) => c.path === "entities.Order.actions.placeOrder.input.note")?.classification
    ).toBe("additive");
    expect(result.hasBreakingChanges).toBe(false);
  });

  it("removing an input field is breaking: existing callers still send it", () => {
    const wider = { roles: ["buyer"], input: { quantity: "int!", note: "string" } };
    const result = diff(model(place(wider)), model(place(buyer)));

    expect(
      result.changes.find((c) => c.path === "entities.Order.actions.placeOrder.input.note")?.classification
    ).toBe("breaking");
  });

  it("retyping an input field is breaking", () => {
    const money = { roles: ["buyer"], input: { quantity: "decimal(12,2)!" } };
    const result = diff(model(place(buyer)), model(place(money)));

    expect(
      result.changes.find((c) => c.path === "entities.Order.actions.placeOrder.input.quantity.type")
        ?.classification
    ).toBe("breaking");
  });
});

describe("action behaviour changes", () => {
  it("changing `when` is breaking", () => {
    const before = { roles: ["buyer"], when: "total > 0" };
    const after = { roles: ["buyer"], when: "total >= 1000" };
    const result = diff(model(place(before)), model(place(after)));

    const change = result.changes.find((c) => c.path === "entities.Order.actions.placeOrder.when");
    expect(change?.classification).toBe("breaking");
    expect(change?.message).toContain("changed what it does");
  });

  it("changing the statement list is reported as `do`, the declared name", () => {
    const before = { roles: ["buyer"], do: [{ call: "stock.reserve" }] };
    const after = { roles: ["buyer"], do: [{ call: "stock.hold" }] };
    const result = diff(model(place(before)), model(place(after)));

    expect(
      result.changes.find((c) => c.path === "entities.Order.actions.placeOrder.do")?.classification
    ).toBe("breaking");
  });

  it("key order in a statement is not a change", () => {
    const before = { roles: ["buyer"], do: [{ call: "stock.reserve", args: {} }] };
    const after = { roles: ["buyer"], do: [{ args: {}, call: "stock.reserve" }] };
    const result = diff(model(place(before)), model(place(after)));

    expect(result.changes).toEqual([]);
  });

  it("a `when` written as an expression is compared like one written as a string", () => {
    const before = { roles: ["buyer"], when: "total > 0" };
    const after = { roles: ["buyer"], when: { op: "gt", args: ["total", 1000] } };
    const result = diff(model(place(before)), model(place(after)));

    expect(
      result.changes.find((c) => c.path === "entities.Order.actions.placeOrder.when")?.classification
    ).toBe("breaking");
  });

  it("an action that gains behaviour it never had is still a behaviour change", () => {
    const bare = { roles: ["buyer"] };
    const withDo = { roles: ["buyer"], do: [{ call: "stock.reserve" }] };
    const result = diff(model(place(bare)), model(place(withDo)));

    expect(
      result.changes.find((c) => c.path === "entities.Order.actions.placeOrder.do")?.classification
    ).toBe("breaking");
  });
});
