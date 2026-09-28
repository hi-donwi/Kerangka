import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compile, CompilerDiagnostic, CompilerError } from "../src/index.js";

const examplesDir = resolve(__dirname, "../../../examples");

/** Compiles and returns the diagnostics; fails the test if compilation succeeds. */
function diagnosticsOf(input: string | Record<string, unknown>): CompilerDiagnostic[] {
  try {
    compile(input as never);
  } catch (err) {
    if (err instanceof CompilerError) {
      return err.diagnostics;
    }
    throw err;
  }
  throw new Error("Expected compilation to fail, but it succeeded");
}

function model(entities: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { kerangka: "0.1", app: "test", ...extra, entities };
}

describe("Compiler validation - field types", () => {
  it("rejects an unknown field type with a pointer and a suggestion", () => {
    const diags = diagnosticsOf(model({ Item: { fields: { qty: "integr!" } } }));
    expect(diags).toHaveLength(1);
    expect(diags[0]).toMatchObject({
      severity: "error",
      code: "UNKNOWN_TYPE",
      path: "/entities/Item/fields/qty",
    });
    expect(diags[0]!.hint).toContain("'integer'");
  });

  it("lists the valid types when nothing is close", () => {
    const diags = diagnosticsOf(model({ Item: { fields: { qty: "zzzzzz" } } }));
    expect(diags[0]!.code).toBe("UNKNOWN_TYPE");
    expect(diags[0]!.hint).toContain("decimal");
  });

  it("rejects an unknown element type in a list", () => {
    const diags = diagnosticsOf(model({ Item: { fields: { tags: { type: "list", element: { type: "strng" } } } } }));
    expect(diags[0]).toMatchObject({ code: "UNKNOWN_TYPE", path: "/entities/Item/fields/tags" });
  });

  it("accepts every type in PLAN.md section 9.1 and a declared value type", () => {
    const fields = {
      a: "string", b: "text", c: "int", d: "decimal(12,2)", e: "float", f: "bool",
      g: "date", h: "datetime", i: "time", j: "uuid", k: "email", l: "url",
      m: "enum(x, y)", n: "json", o: "ref(Other)", p: "list(Other)", q: "list(string)",
      r: { type: "Money" },
    };
    expect(() =>
      compile(model({ Item: { fields }, Other: { fields: { name: "string" } } }, {
        types: { Money: { fields: { amount: "decimal(18,4)!", currency: "string!" } } },
      }) as never)
    ).not.toThrow();
  });
});

describe("Compiler validation - expression references", () => {
  it("rejects a bare name that is not a field of the record", () => {
    const diags = diagnosticsOf(
      model({ Invoice: { fields: { total: "decimal(12,2)", tax: { type: "decimal(12,2)", compute: "totl * 0.1" } } } })
    );
    expect(diags).toHaveLength(1);
    expect(diags[0]).toMatchObject({
      code: "UNKNOWN_FIELD",
      path: "/entities/Invoice/fields/tax/compute",
    });
    expect(diags[0]!.message).toContain("'totl'");
    expect(diags[0]!.hint).toContain("'total'");
  });

  it("checks rule checks, invariant asserts, action guards, and transition guards", () => {
    const diags = diagnosticsOf(
      model({
        Doc: {
          fields: { a: "int", status: "enum(draft, done) = draft" },
          rules: [{ id: "r1", check: "b > 0", message: "m" }],
          invariants: [{ id: "i1", assert: "c > 0", message: "m" }],
          actions: { act: { when: "d > 0", run: { a: "a + 1" } } },
          workflow: { field: "status", transitions: { finish: { from: "draft", to: "done", when: "e > 0" } } },
        },
      })
    );
    expect(diags.map((d) => d.path)).toEqual([
      "/entities/Doc/rules/0/check",
      "/entities/Doc/invariants/0/assert",
      "/entities/Doc/actions/act/when",
      "/entities/Doc/workflow/transitions/finish/when",
    ]);
    expect(diags.every((d) => d.code === "UNKNOWN_FIELD")).toBe(true);
  });

  it("resolves bare names inside a per-row aggregate against the row entity", () => {
    const entities = {
      Invoice: {
        fields: { lines: "list(Line)", total: { type: "decimal(12,2)", compute: "sum(lines, qty * unitPrice)" } },
      },
      Line: { embedded: true, fields: { qty: "int", unitPrice: "decimal(12,2)" } },
    };
    expect(() => compile(model(entities) as never)).not.toThrow();

    const bad = structuredClone(entities);
    bad.Invoice.fields.total.compute = "sum(lines, qty * price)";
    const diags = diagnosticsOf(model(bad));
    expect(diags).toHaveLength(1);
    expect(diags[0]!.message).toContain("'price'");
    expect(diags[0]!.message).toContain("Line");
  });

  it("reaches the outer record through record.<field> inside a per-row aggregate", () => {
    const entities = {
      Invoice: {
        fields: {
          rate: "decimal(5,2)",
          lines: "list(Line)",
          total: { type: "decimal(12,2)", compute: "sum(lines, qty * record.rate)" },
        },
      },
      Line: { embedded: true, fields: { qty: "int" } },
    };
    expect(() => compile(model(entities) as never)).not.toThrow();

    const bad = structuredClone(entities);
    bad.Invoice.fields.total.compute = "sum(lines, qty * record.rat)";
    expect(diagnosticsOf(model(bad))[0]).toMatchObject({ code: "UNKNOWN_FIELD" });
  });

  it("checks input.<name> against the action's declared input", () => {
    const diags = diagnosticsOf(
      model({
        Stock: {
          fields: { qty: "int" },
          actions: { restock: { input: { amount: "int!" }, run: { qty: "qty + input.amont" } } },
        },
      })
    );
    expect(diags).toHaveLength(1);
    expect(diags[0]).toMatchObject({ code: "UNKNOWN_FIELD", path: "/entities/Stock/actions/restock/run/qty" });
    expect(diags[0]!.hint).toContain("'amount'");
  });

  it("allows the explicit roots actor, uses, and ctx", () => {
    expect(() =>
      compile(model({
        Doc: {
          fields: { owner: "string", status: "enum(a, b) = a" },
          workflow: {
            field: "status",
            transitions: { go: { from: "a", to: "b", when: "actor.id == owner && ctx.tenant != null && uses.x == 1" } },
          },
        },
      }) as never)
    ).not.toThrow();
  });

  it("rejects an action run target that is not a field", () => {
    const diags = diagnosticsOf(model({ Todo: { fields: { done: "bool" }, actions: { toggle: { run: { dne: "!done" } } } } }));
    expect(diags[0]).toMatchObject({ code: "UNKNOWN_FIELD", path: "/entities/Todo/actions/toggle/run/dne" });
  });

  it("rejects a rule attached to a field that does not exist", () => {
    const diags = diagnosticsOf(
      model({ Doc: { fields: { a: "int" }, rules: [{ id: "r", field: "b", check: "a > 0", message: "m" }] } })
    );
    expect(diags[0]).toMatchObject({ code: "UNKNOWN_FIELD", path: "/entities/Doc/rules/0/field" });
  });
});

describe("Compiler validation - functions", () => {
  it("rejects an unknown function and suggests the closest built-in", () => {
    const diags = diagnosticsOf(model({ Doc: { fields: { a: "int", b: { type: "int", compute: "abss(a)" } } } }));
    expect(diags[0]).toMatchObject({ code: "UNKNOWN_FUNCTION", path: "/entities/Doc/fields/b/compute" });
    expect(diags[0]!.hint).toContain("'abs'");
  });

  it("accepts a call to a declared decision table", () => {
    expect(() =>
      compile(model(
        { Req: { fields: { days: "int", role: { type: "string", compute: "routing(days)" } } } },
        { decisions: { routing: { hitPolicy: "first", inputs: [], outputs: [], rows: [] } } }
      ) as never)
    ).not.toThrow();
  });
});

describe("Compiler validation - workflow states", () => {
  it("rejects a transition to a state that is not a value of the enum state field", () => {
    const diags = diagnosticsOf(
      model({
        Doc: {
          fields: { status: "enum(draft, sent) = draft" },
          workflow: { field: "status", transitions: { send: { from: "draft", to: "snt" } } },
        },
      })
    );
    expect(diags).toHaveLength(1);
    expect(diags[0]).toMatchObject({ code: "UNKNOWN_STATE", path: "/entities/Doc/workflow/transitions/send/to" });
    expect(diags[0]!.hint).toContain("'sent'");
  });

  it("rejects a from-state that is not in the declared states list", () => {
    const diags = diagnosticsOf(
      model({
        Doc: {
          fields: { status: "string" },
          workflow: { field: "status", states: ["a", "b"], transitions: { go: { from: ["a", "c"], to: "b" } } },
        },
      })
    );
    expect(diags[0]).toMatchObject({ code: "UNKNOWN_STATE", path: "/entities/Doc/workflow/transitions/go/from/1" });
  });
});

describe("Compiler validation - source positions", () => {
  it("adds line and column when compiling JSON text", () => {
    const text = [
      "{",
      '  "kerangka": "0.1",',
      '  "app": "test",',
      '  "entities": {',
      '    "Item": {',
      '      "fields": { "qty": "integr!" }',
      "    }",
      "  }",
      "}",
    ].join("\n");
    const diags = diagnosticsOf(text);
    expect(diags[0]).toMatchObject({ code: "UNKNOWN_TYPE", line: 6, column: 26 });
  });

  it("adds line and column when compiling YAML text", () => {
    const text = [
      "kerangka: '0.1'",
      "app: test",
      "entities:",
      "  Item:",
      "    fields:",
      "      qty: integr!",
    ].join("\n");
    const diags = diagnosticsOf(text);
    expect(diags[0]).toMatchObject({ code: "UNKNOWN_TYPE", line: 6, column: 12 });
  });

  it("points a JSON syntax error at its line and column", () => {
    const diags = diagnosticsOf('{\n  "app": "x",\n  "entities": {,}\n}');
    expect(diags[0]!.code).toBe("PARSE_ERROR");
    expect(diags[0]!.line).toBe(3);
    expect(diags[0]!.column).toBeGreaterThan(0);
  });

  it("reports every error, not only the first", () => {
    const diags = diagnosticsOf(model({ A: { fields: { x: "nmber", y: { type: "int", compute: "zz + 1" } } } }));
    expect(diags.map((d) => d.code)).toEqual(["UNKNOWN_TYPE", "UNKNOWN_FIELD"]);
  });
});

describe("Compiler validation - every diagnostic is actionable", () => {
  it("gives existing diagnostics a pointer and a hint", () => {
    const diags = diagnosticsOf({
      kerangka: "0.1",
      entities: {
        A: { uses: ["Auditabel"], fields: { b: "ref(Bee)", c: { type: "int", compute: "1 +" } } },
      },
      traits: { Auditable: { fields: { createdBy: "string" } } },
    });
    expect(diags.map((d) => d.code).sort()).toEqual(
      ["EXPRESSION_ERROR", "MISSING_APP_NAME", "UNKNOWN_REFERENCE", "UNKNOWN_TRAIT"].sort()
    );
    for (const d of diags) {
      expect(d.path, d.code).toMatch(/^\//);
      expect(d.hint, d.code).toBeTruthy();
    }
  });
});

describe("Compiler validation - examples stay valid", () => {
  const files = readdirSync(examplesDir).filter((f) => f.endsWith(".kerangka.json"));

  it.each(files)("%s compiles without diagnostics", (file) => {
    expect(() => compile(readFileSync(resolve(examplesDir, file), "utf8"))).not.toThrow();
  });
});
