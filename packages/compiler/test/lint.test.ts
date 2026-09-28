import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import * as fs from "node:fs";
import {
  compile,
  KerangkaLinter,
  kerangkaRecommendedPreset,
  lintDocument,
  LintPreset,
} from "../src/index.js";
import { RawKerangkaDocument } from "../src/types.js";

const examplesDir = resolve(__dirname, "../../../examples");

/** Compiles a document and lints it, so a test only states the model it needs. */
function lint(doc: RawKerangkaDocument | string, options: Parameters<typeof lintDocument>[1] = {}) {
  const text = typeof doc === "string" ? doc : JSON.stringify(doc, null, 2);
  const kir = compile(text, { sourcePath: "inline.kerangka.json" });
  return lintDocument(kir, { sourceText: text, rootDoc: JSON.parse(text), ...options });
}

function codes(doc: RawKerangkaDocument | string, options?: Parameters<typeof lintDocument>[1]) {
  return lint(doc, options).diagnostics.map((d) => d.code);
}

/** Lints a set of loaded contexts, the way a workspace reaches the linter. */
function lintContexts(
  defs: Record<string, Record<string, unknown>>,
  options: Parameters<typeof lintDocument>[1] = {}
) {
  const kir = compile(JSON.stringify(minimal), { sourcePath: "inline.kerangka.json" });
  const contexts = Object.fromEntries(
    Object.entries(defs).map(([name, def]) => [
      name,
      { name, dir: name, def: { context: name, ...def } as never },
    ])
  );
  return lintDocument(kir, { ...options, contexts });
}

const minimal: RawKerangkaDocument = {
  kerangka: "0.1",
  app: "shop",
  entities: {
    Order: { fields: { number: "string!", status: "string = 'draft'" } },
  },
};

describe("KerangkaLinter - preset", () => {
  it("exposes the documented kerangka:recommended budgets", () => {
    expect(kerangkaRecommendedPreset.name).toBe("kerangka:recommended");
    expect(kerangkaRecommendedPreset.budgets).toEqual({
      linesPerFile: 300,
      fieldsPerAggregate: 40,
      statementsPerAction: 10,
      nodesPerExpression: 30,
      transitionsPerWorkflow: 15,
      aggregatesPerContext: 12,
      dependenciesPerContext: 4,
    });
  });

  it("lets an organisation preset tighten one budget without touching the rest", () => {
    const preset: LintPreset = {
      ...kerangkaRecommendedPreset,
      name: "acme:strict",
      budgets: { ...kerangkaRecommendedPreset.budgets, fieldsPerAggregate: 1 },
    };
    expect(codes(minimal, { preset })).toContain("BUDGET_FIELDS_PER_AGGREGATE");
    expect(codes(minimal, { preset })).not.toContain("BUDGET_LINES_PER_FILE");
  });

  it("reads budget overrides from the document root so a model carries its own preset", () => {
    const tight: RawKerangkaDocument = {
      ...minimal,
      lint: { budgets: { fieldsPerAggregate: 1 } },
    };
    expect(codes(tight)).toContain("BUDGET_FIELDS_PER_AGGREGATE");
  });

  it("reports every diagnostic with a code, a pointer, and a hint", () => {
    const bad: RawKerangkaDocument = {
      kerangka: "0.1",
      app: "Bad_App",
      entities: { order: { fields: { "Order Number": "string!" } } },
      events: { Order: { id: "uuid!" } },
    };
    for (const d of lint(bad).diagnostics) {
      expect(d.code).toBeTruthy();
      expect(d.message).toBeTruthy();
      expect(d.hint).toBeTruthy();
      expect(d.path).toBeTruthy();
    }
  });
});

describe("KerangkaLinter - naming rules", () => {
  it("wants contexts in kebab-case", () => {
    expect(lintContexts({ Sales_Orders: {} }).diagnostics.map((d) => d.code)).toContain(
      "CONTEXT_NAMING"
    );
  });

  it("wants aggregates and types in PascalCase", () => {
    expect(codes({ ...minimal, entities: { order: { fields: { id: "uuid!" } } } })).toContain(
      "AGGREGATE_NAMING"
    );
    expect(codes({ ...minimal, types: { money: { fields: { amount: "decimal(12,2)!" } } } })).toContain(
      "TYPE_NAMING"
    );
  });

  it("wants events in PascalCase and in the past tense", () => {
    expect(codes({ ...minimal, events: { orderPaid: { id: "uuid!" } } })).toContain("EVENT_NAMING");
    expect(codes({ ...minimal, events: { PlaceOrder: { id: "uuid!" } } })).toContain("EVENT_TENSE");
  });

  it("accepts irregular past-tense event names", () => {
    for (const name of ["OrderPlaced", "InvoicePaid", "InvoiceSent", "OrderCancelled", "StockTaken"]) {
      expect(codes({ ...minimal, events: { [name]: { id: "uuid!" } } })).not.toContain("EVENT_TENSE");
    }
  });

  it("wants fields, actions, and defs in camelCase", () => {
    expect(codes({ ...minimal, entities: { Order: { fields: { order_number: "string!" } } } })).toContain(
      "FIELD_NAMING"
    );
    expect(
      codes({
        ...minimal,
        entities: { Order: { fields: { id: "uuid!" }, actions: { MarkPaid: {} } } },
      })
    ).toContain("ACTION_NAMING");
    expect(codes({ ...minimal, defs: { IsOverdue: "true" } })).toContain("DEF_NAMING");
  });

  it("wants the app id in kebab-case", () => {
    expect(codes({ ...minimal, app: "MyShop" })).toContain("APP_NAMING");
  });
});

describe("KerangkaLinter - complexity budgets", () => {
  it("keeps a file under 300 lines by default", () => {
    const wide = JSON.stringify(
      {
        ...minimal,
        entities: {
          Order: {
            fields: Object.fromEntries(
              Array.from({ length: 320 }, (_, i) => [`f${i}`, "string!"])
            ),
          },
        },
      },
      null,
      2
    );
    expect(codes(wide)).toContain("BUDGET_LINES_PER_FILE");
  });

  it("keeps an aggregate under 40 fields by default", () => {
    const many = JSON.stringify(
      {
        ...minimal,
        entities: {
          Order: {
            fields: Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`f${i}`, "string!"])),
          },
        },
      },
      null,
      2
    );
    expect(codes(many)).toContain("BUDGET_FIELDS_PER_AGGREGATE");
  });

  it("keeps an action under 10 statements by default", () => {
    const fields = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`f${i}`, "int"]));
    const run = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`f${i}`, "1 + 1"]));
    expect(
      codes({
        ...minimal,
        entities: { Order: { fields, actions: { settle: { run } } } },
      })
    ).toContain("BUDGET_STATEMENTS_PER_ACTION");
  });

  it("keeps an expression under 30 nodes by default", () => {
    // The compiler refuses an expression past 100 nodes; the lint budget is far lower,
    // so an expression like this one compiles and is still worth splitting.
    const chain = Array.from({ length: 18 }, (_, i) => `a + ${i}`).join(" + ");
    const long = `${chain} && (b == 1 || b == 2)`;
    expect(
      codes({
        ...minimal,
        entities: {
          Order: {
            fields: { id: "uuid!", a: "int", b: "int" },
            invariants: [{ id: "big", message: "too big", assert: long }],
          },
        },
      })
    ).toContain("BUDGET_NODES_PER_EXPRESSION");
  });

  it("keeps a workflow under 15 transitions by default", () => {
    const transitions = Object.fromEntries(
      Array.from({ length: 16 }, (_, i) => [`t${i}`, { from: "a", to: "b" }])
    );
    expect(
      codes({
        ...minimal,
        entities: {
          Order: {
            fields: { id: "uuid!" },
            workflow: { field: "status", states: ["a", "b"], initial: "a", terminal: ["b"], transitions },
          },
        },
      })
    ).toContain("BUDGET_TRANSITIONS_PER_WORKFLOW");
  });

  it("quotes the budget and the measured value in the message", () => {
    const many = JSON.stringify(
      {
        ...minimal,
        entities: {
          Order: {
            fields: Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`f${i}`, "string!"])),
          },
        },
      },
      null,
      2
    );
    const d = lint(many).diagnostics.find((x) => x.code === "BUDGET_FIELDS_PER_AGGREGATE")!;
    expect(d.message).toContain("41");
    expect(d.message).toContain("40");
    expect(d.hint).toBe("Extract a value object or a new aggregate.");
  });
});

describe("KerangkaLinter - unused declarations", () => {
  it("warns about an exported name no other context uses", () => {
    const d = lintContexts(
      {
        orders: {
          exports: { events: ["OrderPlaced", "OrderArchived"] },
          events: { OrderPlaced: { id: "uuid!" }, OrderArchived: { id: "uuid!" } },
        },
        billing: {
          dependsOn: ["orders"],
          exports: { events: ["InvoicePaid"] },
          events: { InvoicePaid: { id: "uuid!" } },
          policies: { onOrderPlaced: { on: "orders.OrderPlaced", run: {} } },
        },
      }
    ).diagnostics.filter((x) => x.code === "UNUSED_EXPORT");
    const messages = d.map((x) => x.message).join(" ");
    expect(messages).toContain("OrderArchived");
    expect(messages).not.toContain("OrderPlaced");
  });

  it("warns about a def no expression ever uses", () => {
    expect(codes({ ...minimal, defs: { isOverdue: "true" } })).toContain("UNUSED_DEF");
  });

  it("stays silent about unused checks in a single-file document with no contexts", () => {
    expect(codes(minimal).filter((c) => c.startsWith("UNUSED_"))).toEqual([]);
  });
});

describe("KerangkaLinter - boundaries", () => {
  it("reports an export the context does not define", () => {
    const d = lintContexts({
      orders: {
        exports: { events: ["OrderPlaced", "GhostEvent"] },
        events: { OrderPlaced: { id: "uuid!" } },
      },
    }).diagnostics.filter((x) => x.code === "EXPORT_NOT_DEFINED");
    expect(d).toHaveLength(1);
    expect(d[0]!.message).toContain("GhostEvent");
    expect(d[0]!.severity).toBe("error");
  });

  it("keeps an aggregate or context under its budget and counts structural dependencies", () => {
    const many = Object.fromEntries(
      Array.from({ length: 13 }, (_, i) => [`Aggregate${i}`, { fields: { id: "uuid!" } }])
    );
    const d = lintContexts({ big: { entities: many, dependsOn: ["a", "b", "c", "d", "e"] } })
      .diagnostics.map((x) => x.code);
    expect(d).toContain("BUDGET_AGGREGATES_PER_CONTEXT");
    expect(d).toContain("BUDGET_DEPENDENCIES_PER_CONTEXT");
  });

  it("warns about a uses load that crosses a service boundary under a topology", () => {
    const d = lintContexts(
      {
        billing: { dependsOn: ["orders"], queries: { invoiceLines: { from: "orders", load: "getOrder" } } },
        orders: {},
      },
      {
        topology: {
          topologies: {
            distributed: {
              services: {
                "orders-service": { contexts: ["orders"] },
                "billing-service": { contexts: ["billing"] },
              },
            },
          },
        } as never,
        topologyName: "distributed",
      }
    ).diagnostics.filter((x) => x.code === "CROSS_SERVICE_LOAD");
    expect(d).toHaveLength(1);
    expect(d[0]!.message).toContain("orders-service");
    expect(d[0]!.hint).toContain("network call");
  });

  it("keeps a uses load inside one service out of the report", () => {
    const d = lintContexts(
      {
        billing: { dependsOn: ["orders"], queries: { invoiceLines: { from: "orders", load: "getOrder" } } },
        orders: {},
      },
      {
        topology: {
          topologies: { monolith: { services: { "commerce-api": { contexts: ["orders", "billing"] } } } },
        } as never,
        topologyName: "monolith",
      }
    ).diagnostics.filter((x) => x.code === "CROSS_SERVICE_LOAD");
    expect(d).toHaveLength(0);
  });
});

describe("KerangkaLinter - the phase 1 exit gate", () => {
  it("passes on every single-file example with the recommended preset", () => {
    for (const name of ["todo", "invoicing", "leave-request", "inventory"]) {
      const file = resolve(examplesDir, `${name}.kerangka.json`);
      const text = fs.readFileSync(file, "utf8");
      const result = lintDocument(compile(text, { sourcePath: file }), {
        sourcePath: file,
        sourceText: text,
        rootDoc: JSON.parse(text),
      });
      expect(result.diagnostics.filter((d) => d.code.startsWith("BUDGET_"))).toEqual([]);
      expect(result.ok).toBe(true);
    }
  });

  it("passes on the commerce workspace with the recommended preset", () => {
    const file = resolve(examplesDir, "commerce/kerangka.json");
    const text = fs.readFileSync(file, "utf8");
    const result = lintDocument(compile(text, { sourcePath: file }), {
      sourcePath: file,
      sourceText: text,
      rootDoc: JSON.parse(text),
    });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });
});

describe("KerangkaLinter - API surface", () => {
  it("is reachable as a class as well as a function", () => {
    const kir = compile(JSON.stringify(minimal), { sourcePath: "inline.kerangka.json" });
    const result = new KerangkaLinter({ sourceText: JSON.stringify(minimal) }).lint(kir);
    expect(result.ok).toBe(true);
    expect(result.counts.entities).toBe(1);
  });
});
