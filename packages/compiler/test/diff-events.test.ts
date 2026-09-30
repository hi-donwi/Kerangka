import { describe, expect, it } from "vitest";
import { compile, diffModels } from "@kerangka/compiler";

/**
 * An event is a contract with every consumer that subscribes to it, so a payload
 * change is a breaking change in the same sense a column change is. The hints are the
 * two-phase transitions ADR-0032 requires: introduce optional, tighten later, and
 * never remove in one step.
 */
const model = (events: Record<string, unknown>, policies?: Record<string, unknown>) =>
  compile(
    JSON.stringify({
      kerangka: "0.1",
      app: "contracts",
      entities: { Order: { fields: { id: "string!" } } },
      events,
      ...(policies ? { policies } : {}),
    })
  );

const diff = (before: ReturnType<typeof model>, after: ReturnType<typeof model>) =>
  diffModels(before, after);

describe("event payload changes", () => {
  it("removing an event is breaking", () => {
    const result = diff(
      model({ OrderPlaced: { orderId: "uuid!" }, OrderCancelled: { orderId: "uuid!" } }),
      model({ OrderPlaced: { orderId: "uuid!" } })
    );

    const change = result.changes.find((c) => c.path === "events.OrderCancelled");
    expect(change?.classification).toBe("breaking");
    expect(change?.hint).toContain("Stop emitting it in one version");
    expect(result.hasBreakingChanges).toBe(true);
  });

  it("adding an event is additive", () => {
    const result = diff(
      model({ OrderPlaced: { orderId: "uuid!" } }),
      model({ OrderPlaced: { orderId: "uuid!" }, OrderRefunded: { orderId: "uuid!" } })
    );

    expect(result.changes.find((c) => c.path === "events.OrderRefunded")?.classification).toBe(
      "additive"
    );
    expect(result.hasBreakingChanges).toBe(false);
  });

  it("removing a field from a payload is breaking", () => {
    const result = diff(
      model({ OrderPlaced: { orderId: "uuid!", amount: "decimal(12,2)" } }),
      model({ OrderPlaced: { orderId: "uuid!" } })
    );

    const change = result.changes.find((c) => c.path === "events.OrderPlaced.amount");
    expect(change?.classification).toBe("breaking");
    // One field-map comparison serves columns, payloads, and action input, so the
    // hint speaks about the producer that sends the field rather than one shape.
    expect(change?.hint).toContain("Stop sending the field");
  });

  it("adding a required field without a default is breaking, with the two-phase hint", () => {
    const result = diff(
      model({ OrderPlaced: { orderId: "uuid!" } }),
      model({ OrderPlaced: { orderId: "uuid!", total: "decimal(12,2)!" } })
    );

    const change = result.changes.find((c) => c.path === "events.OrderPlaced.total");
    expect(change?.classification).toBe("breaking");
    expect(change?.hint).toContain("Add it optional first");
  });

  it("adding an optional field is additive", () => {
    const result = diff(
      model({ OrderPlaced: { orderId: "uuid!" } }),
      model({ OrderPlaced: { orderId: "uuid!", note: "string" } })
    );

    expect(result.changes.find((c) => c.path === "events.OrderPlaced.note")?.classification).toBe(
      "additive"
    );
    expect(result.hasBreakingChanges).toBe(false);
  });

  it("retyping a field is breaking", () => {
    const result = diff(
      model({ OrderPlaced: { orderId: "uuid!" } }),
      model({ OrderPlaced: { orderId: "string!" } })
    );

    const change = result.changes.find((c) => c.path === "events.OrderPlaced.orderId.type");
    expect(change?.classification).toBe("breaking");
    expect(change?.before).toBe("uuid");
    expect(change?.after).toBe("string");
  });

  it("making a field required is the contract phase, and is breaking without a default", () => {
    const result = diff(
      model({ OrderPlaced: { orderId: "uuid", note: "string" } }),
      model({ OrderPlaced: { orderId: "uuid", note: "string!" } })
    );

    const change = result.changes.find((c) => c.path === "events.OrderPlaced.note.required");
    expect(change?.classification).toBe("breaking");
    expect(change?.hint).toContain("Contract phase");
  });

  it("relaxing a field to optional is compatible", () => {
    const result = diff(
      model({ OrderPlaced: { orderId: "uuid", note: "string!" } }),
      model({ OrderPlaced: { orderId: "uuid", note: "string" } })
    );

    expect(result.changes.find((c) => c.path === "events.OrderPlaced.note.required")?.classification).toBe(
      "compatible"
    );
    expect(result.hasBreakingChanges).toBe(false);
  });

  it("removing an enum value is breaking", () => {
    const result = diff(
      model({ OrderPlaced: { orderId: "uuid", state: "enum(draft, placed, paid)!" } }),
      model({ OrderPlaced: { orderId: "uuid", state: "enum(draft, paid)!" } })
    );

    const change = result.changes.find((c) => c.path === "events.OrderPlaced.state.values");
    expect(change?.classification).toBe("breaking");
    expect(change?.message).toContain("'placed'");
  });

  it("compares field shorthand the same way the model stores it", () => {
    // `decimal(12,2)` and `decimal(10,2)` are the same type: precision is not a type.
    const result = diff(
      model({ OrderPlaced: { amount: "decimal(12,2)!" } }),
      model({ OrderPlaced: { amount: "decimal(10,2)!" } })
    );

    expect(result.changes).toEqual([]);
  });

  it("accepts the whole expand then contract sequence", () => {
    const v1 = model({ OrderPlaced: { orderId: "uuid!" } });
    const v2 = model({ OrderPlaced: { orderId: "uuid!", note: "string" } });
    const v3 = model({ OrderPlaced: { orderId: "uuid!", note: "string!" } });

    expect(diff(v1, v2).hasBreakingChanges).toBe(false);
    // The contract phase is only breaking against a producer that never shipped the
    // field; against v2, which has emitted it, it is a legal second step.
    expect(diff(v2, v3).changes.find((c) => c.path === "events.OrderPlaced.note.required")).toBeDefined();
  });
});

describe("policy changes", () => {
  const withPolicies = (policies: Record<string, unknown>) => model({ OrderPlaced: { orderId: "uuid!" } }, policies);

  it("removing a policy is breaking", () => {
    const result = diff(
      withPolicies({ onOrderPlaced: { on: "OrderPlaced", run: "Invoice.create" } }),
      withPolicies({})
    );

    const change = result.changes.find((c) => c.path === "policies.onOrderPlaced");
    expect(change?.classification).toBe("breaking");
    expect(change?.message).toContain("no longer has a reaction");
  });

  it("repointing a policy is breaking", () => {
    const result = diff(
      withPolicies({ onOrderPlaced: { on: "OrderPlaced", run: "Invoice.create" } }),
      withPolicies({ onOrderPlaced: { on: "OrderRefunded", run: "Invoice.create" } })
    );

    expect(result.changes.find((c) => c.path === "policies.onOrderPlaced.on")?.classification).toBe(
      "breaking"
    );
  });

  it("retargeting a policy's action is breaking", () => {
    const result = diff(
      withPolicies({ onOrderPlaced: { on: "OrderPlaced", run: "Invoice.create" } }),
      withPolicies({ onOrderPlaced: { on: "OrderPlaced", run: "CreditNote.create" } })
    );

    expect(result.changes.find((c) => c.path === "policies.onOrderPlaced.run")?.classification).toBe(
      "breaking"
    );
  });

  it("adding a policy is additive", () => {
    const result = diff(
      withPolicies({}),
      withPolicies({ onOrderPlaced: { on: "OrderPlaced", run: "Invoice.create" } })
    );

    expect(result.changes.find((c) => c.path === "policies.onOrderPlaced")?.classification).toBe(
      "additive"
    );
    expect(result.hasBreakingChanges).toBe(false);
  });
});
