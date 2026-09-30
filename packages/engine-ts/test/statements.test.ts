import { describe, expect, it } from "vitest";
import { compile } from "@kerangka/compiler";
import { loadEngine } from "../src/index.js";

/**
 * PLAN.md §5.6: the statement vocabulary, applied in declaration order. One executor
 * serves a transition's `then` and an action's `do`, so a nested `if` behaves like
 * the top level.
 */
function engineFrom(doc: Record<string, unknown>) {
  return loadEngine(compile(JSON.parse(JSON.stringify(doc))));
}

const actor = { id: "u-1", roles: ["ops"] };

const basketDoc = (statements: unknown[], states: string[] = ["draft", "sent"]) => ({
  kerangka: "0.1",
  app: "statements",
  entities: {
    Order: {
      fields: {
        id: "string!",
        total: "decimal(12,2)!",
        status: "string! = 'draft'",
        label: "string",
        tags: "list<string> = []",
        note: "string",
      },
      workflow: {
        field: "status",
        states,
        initial: "draft",
        transitions: {
          send: { from: "draft", to: "sent", then: statements },
        },
      },
    },
    Note: {
      fields: { id: "string!", body: "string!" },
    },
  },
});

const draft = { id: "o-1", total: 100, status: "draft" };

describe("append and remove", () => {
  it("appends a computed value to an embedded list", () => {
    const engine = engineFrom(basketDoc([{ append: { tags: "concat('t-', id)" } }]));
    const result = engine.run("Order", "send", draft, {}, actor);

    expect(result.ok).toBe(true);
    expect(result.record?.tags).toEqual(["t-o-1"]);
  });

  it("appends to an existing list rather than replacing it", () => {
    const engine = engineFrom(basketDoc([{ append: { tags: "'gift'" } }]));
    const result = engine.run("Order", "send", { ...draft, tags: ["paid"] }, {}, actor);

    expect(result.record?.tags).toEqual(["paid", "gift"]);
  });

  it("removes a matching element", () => {
    const engine = engineFrom(basketDoc([{ remove: { tags: "'paid'" } }]));
    const result = engine.run("Order", "send", { ...draft, tags: ["paid", "gift"] }, {}, actor);

    expect(result.record?.tags).toEqual(["gift"]);
  });
});

describe("create", () => {
  it("creates a valid aggregate in the same context as a persist effect", () => {
    const engine = engineFrom(
      basketDoc([{ create: { entity: "Note", values: { id: "n-1", body: "created" } } }]),
    );
    const result = engine.run("Order", "send", draft, {}, actor);

    expect(result.ok).toBe(true);
    const created = result.effects?.find(
      (e) => e.type === "persist" && e.entity === "Note",
    ) as { record?: Record<string, unknown> } | undefined;
    expect(created?.record).toEqual({ id: "n-1", body: "created" });
  });

  it("computes created values with the cell rule", () => {
    const engine = engineFrom(
      basketDoc([{ create: { entity: "Note", values: { id: "n-1", body: "order" } } }]),
    );
    const result = engine.run("Order", "send", draft, {}, actor);

    const created = result.effects?.find(
      (e) => e.type === "persist" && e.entity === "Note",
    ) as { record?: Record<string, unknown> } | undefined;
    expect(created?.record?.body).toBe("order");
  });

  it("refuses to create an invalid aggregate", () => {
    const engine = engineFrom(
      basketDoc([{ create: { entity: "Note", values: { id: "n-1" } } }]),
    );
    const result = engine.run("Order", "send", draft, {}, actor);
    console.log("INVALID CREATE:", JSON.stringify(result));

    expect(result.ok).toBe(false);
    expect(result.effects ?? []).not.toContainEqual(
      expect.objectContaining({ type: "persist", entity: "Note" }),
    );
  });

  it("refuses an unknown entity even in IR that skipped the compiler", () => {
    // The compiler already rejects this; the engine does not rely on having been told.
    const engine = loadEngine({
      kerangka: "0.1",
      app: "statements",
      entities: {
        Order: {
          fields: { id: "string!", status: "string! = 'draft'" },
          workflow: {
            field: "status",
            states: ["draft", "sent"],
            initial: "draft",
            transitions: {
              send: { from: "draft", to: "sent", then: [{ create: { entity: "Ghost", values: { id: "g-1" } } }] },
            },
          },
        },
      },
    } as never);
    const result = engine.run("Order", "send", draft, {}, actor);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("CREATE_UNKNOWN_ENTITY");
  });
});

describe("if", () => {
  it("takes the then branch on a true condition", () => {
    const engine = engineFrom(
      basketDoc([
        { if: "total > 50", then: [{ set: { label: "'large'" } }], else: [{ set: { label: "'small'" } }] },
      ]),
    );
    const result = engine.run("Order", "send", draft, {}, actor);

    expect(result.record?.label).toBe("large");
  });

  it("takes the else branch on a false condition", () => {
    const engine = engineFrom(
      basketDoc([
        { if: "total > 500", then: [{ set: { label: "'large'" } }], else: [{ set: { label: "'small'" } }] },
      ]),
    );
    const result = engine.run("Order", "send", draft, {}, actor);

    expect(result.record?.label).toBe("small");
  });

  it("fails closed when the condition is not a boolean", () => {
    const engine = engineFrom(
      basketDoc([
        { if: "id", then: [{ set: { label: "'taken'" } }], else: [{ set: { label: "'other'" } }] },
      ]),
    );
    const result = engine.run("Order", "send", draft, {}, actor);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("IF_INDETERMINATE");
  });

  it("nests", () => {
    const engine = engineFrom(
      basketDoc([
        {
          if: "total > 50",
          then: [{ if: "total > 500", then: [{ set: { label: "'huge'" } }], else: [{ set: { label: "'large'" } }] }],
        },
      ]),
    );
    const result = engine.run("Order", "send", draft, {}, actor);

    expect(result.record?.label).toBe("large");
  });
});

describe("transition", () => {
  it("moves the record through another declared transition", () => {
    const engine = engineFrom({
      kerangka: "0.1",
      app: "statements",
      entities: {
        Order: {
          fields: { id: "string!", status: "string! = 'draft'", note: "string" },
          workflow: {
            field: "status",
            states: ["draft", "sent", "archived"],
            initial: "draft",
            transitions: {
              send: {
                from: "draft",
                to: "sent",
                then: [
                  { set: { note: "'dispatching'" } },
                  { transition: "archive" },
                ],
              },
              archive: { from: "sent", to: "archived", then: [{ set: { note: "'archived'" } }] },
            },
          },
        },
      },
    });

    const result = engine.run("Order", "send", { id: "o-1", status: "draft" }, {}, actor);

    expect(result.ok).toBe(true);
    expect(result.record?.status).toBe("archived");
    expect(result.record?.note).toBe("archived");
  });

  it("refuses an unknown transition even in IR that skipped the compiler", () => {
    const engine = loadEngine({
      kerangka: "0.1",
      app: "statements",
      entities: {
        Order: {
          fields: { id: "string!", status: "string! = 'draft'" },
          workflow: {
            field: "status",
            states: ["draft", "sent"],
            initial: "draft",
            transitions: {
              send: { from: "draft", to: "sent", then: [{ transition: "teleport" }] },
            },
          },
        },
      },
    } as never);
    const result = engine.run("Order", "send", draft, {}, actor);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TRANSITION_UNKNOWN");
  });
});

describe("an unknown statement", () => {
  it("is refused rather than ignored", () => {
    const engine = loadEngine({
      kerangka: "0.1",
      app: "statements",
      entities: {
        Order: {
          fields: { id: "string!", status: "string! = 'draft'" },
          workflow: {
            field: "status",
            states: ["draft", "sent"],
            initial: "draft",
            transitions: {
              send: { from: "draft", to: "sent", then: [{ teleport: { to: "sent" } }] },
            },
          },
        },
      },
    } as never);
    const result = engine.run("Order", "send", draft, {}, actor);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("STATEMENT_UNKNOWN");
  });
});

describe("an action statement list", () => {
  it("runs the same vocabulary under `do`", () => {
    const engine = engineFrom({
      kerangka: "0.1",
      app: "statements",
      entities: {
        Order: {
          fields: { id: "string!", total: "decimal(12,2)!", status: "string! = 'draft'", note: "string" },
          actions: {
            flag: {
              roles: ["ops"],
              do: [
                { if: "total > 50", then: [{ set: { note: "'flagged'" } }] },
                { append: { tags: "'x'" } },
              ],
            },
          },
        },
      },
    });

    const result = engine.run("Order", "flag", { id: "o-1", total: 100, status: "draft" }, {}, actor);

    expect(result.ok).toBe(true);
    expect(result.record?.note).toBe("flagged");
  });
});
