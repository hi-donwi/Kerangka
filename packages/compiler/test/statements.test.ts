import { describe, expect, it } from "vitest";
import { compile } from "@kerangka/compiler";

/**
 * PLAN.md §5.6 declares a fixed statement vocabulary, so a typo is a compile error rather
 * than a statement the engine ignores at run time.
 */
function diagnosticsFor(doc: Record<string, unknown>) {
  try {
    compile(JSON.parse(JSON.stringify(doc)));
    return [] as { code: string; message: string; hint?: string }[];
  } catch (err) {
    return (err as { diagnostics?: { code: string; message: string; hint?: string }[] }).diagnostics ?? [];
  }
}

const orderDoc = (then: unknown) => ({
  kerangka: "0.1",
  app: "statements",
  entities: {
    Order: {
      fields: { id: "string!", status: "string! = 'draft'" },
      workflow: {
        field: "status",
        states: ["draft", "sent"],
        initial: "draft",
        transitions: { send: { from: "draft", to: "sent", then } },
      },
    },
    Note: { fields: { id: "string!" } },
  },
});

describe("statement diagnostics", () => {
  it("accepts the declared vocabulary", () => {
    const diagnostics = diagnosticsFor(
      orderDoc([
        { set: { status: "'sent'" } },
        { append: { tags: "'x'" } },
        { remove: { tags: "'x'" } },
        { create: { entity: "Note", values: { id: "n-1" } } },
        { emit: "Noted", data: {} },
        { call: "notify", input: {} },
        { fail: { code: "STOP", message: "no" } },
        { if: "id == 'o-1'", then: [{ set: { status: "'sent'" } }], else: [] },
      ]),
    );

    expect(diagnostics).toEqual([]);
  });

  it("refuses an unknown statement", () => {
    const diagnostics = diagnosticsFor(orderDoc([{ teleport: { to: "sent" } }]));

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("STATEMENT_UNKNOWN");
    expect(diagnostics[0]?.hint).toContain("append");
  });

  it("refuses a create of an unknown entity", () => {
    const diagnostics = diagnosticsFor(
      orderDoc([{ create: { entity: "Ghost", values: { id: "g-1" } } }]),
    );

    expect(diagnostics[0]?.code).toBe("UNKNOWN_ENTITY");
    expect(diagnostics[0]?.message).toContain("Ghost");
  });

  it("refuses a transition that is not declared", () => {
    const diagnostics = diagnosticsFor(orderDoc([{ transition: "teleport" }]));

    expect(diagnostics[0]?.code).toBe("UNKNOWN_TRANSITION");
    expect(diagnostics[0]?.hint).toContain("send");
  });

  it("checks statements nested inside if", () => {
    const diagnostics = diagnosticsFor(
      orderDoc([{ if: "id == 'o-1'", then: [{ teleport: {} }] }]),
    );

    expect(diagnostics[0]?.code).toBe("STATEMENT_UNKNOWN");
  });

  it("refuses a statement list that is not an array", () => {
    const diagnostics = diagnosticsFor(orderDoc({ set: { status: "'sent'" } }));

    expect(diagnostics[0]?.code).toBe("SCHEMA_INVALID");
  });

  it("refuses nesting deeper than eight levels", () => {
    let nested: unknown = [{ set: { status: "'sent'" } }];
    for (let i = 0; i < 10; i++) {
      nested = [{ if: "id == 'o-1'", then: nested as unknown[] }];
    }

    const diagnostics = diagnosticsFor(orderDoc(nested));
    expect(diagnostics[0]?.code).toBe("SCHEMA_INVALID");
    expect(diagnostics[0]?.message).toContain("too deeply");
  });

  it("checks an action statement list under do", () => {
    const diagnostics = diagnosticsFor({
      kerangka: "0.1",
      app: "statements",
      entities: {
        Order: {
          fields: { id: "string!" },
          actions: { flag: { roles: ["ops"], do: [{ teleport: {} }] } },
        },
      },
    });

    expect(diagnostics[0]?.code).toBe("STATEMENT_UNKNOWN");
  });

  it("keeps the action statement list in the compiled IR", () => {
    const ir = compile(
      JSON.parse(
        JSON.stringify({
          kerangka: "0.1",
          app: "statements",
          entities: {
            Order: {
              fields: { id: "string!" },
              actions: { flag: { roles: ["ops"], do: [{ set: { note: "'flagged'" } }] } },
            },
          },
        }),
      ),
    );

    const action = ir.entities.Order?.actions?.flag as { then?: unknown[] };
    expect(Array.isArray(action?.then)).toBe(true);
  });
});
