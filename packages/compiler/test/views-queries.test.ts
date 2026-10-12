/**
 * Two things a model could say that were silently read as nothing:
 *
 * - a view that is not a `dashboard`, a `list`, or a `form` rendered no screen, which is how
 *   `{ "type": "list", "entity": "Todo" }` sat in two shipped examples doing nothing;
 * - a named query whose `where` was text reached the store as a string, the REST evaluator
 *   skipped it, and the query answered with every row.
 */

import { describe, expect, it } from "vitest";
import { compile } from "../src/index.js";
import { validateModelStructure } from "../src/meta-schema.js";
import { CompilerError, type CompilerDiagnostic } from "../src/types.js";

const base = {
  kerangka: "0.1",
  app: "probe",
  entities: { Task: { fields: { title: "string!", status: "enum(open, done) = open" } } },
};

function diagnosticsOf(doc: unknown): CompilerDiagnostic[] {
  try {
    compile(doc as never);
  } catch (err) {
    if (err instanceof CompilerError) return err.diagnostics;
    throw err;
  }
  throw new Error("expected the document not to compile");
}

describe("a view says what it is", () => {
  it("names the fix for a view written as type and entity", () => {
    const diagnostics = validateModelStructure({ ...base, views: { home: { type: "list", entity: "Task" } } });
    expect(diagnostics.map((d) => [d.code, d.path])).toEqual([
      ["UNKNOWN_KEY", "/views/home/type"],
      ["UNKNOWN_KEY", "/views/home/entity"],
    ]);
    expect(diagnostics[0]?.hint).toBe('A view names its kind as the key: write "list": "Task".');
  });

  it("refuses a view that is no kind at all, and one that is two", () => {
    expect(validateModelStructure({ ...base, views: { a: { columns: ["title"] } } }).map((d) => d.code)).toEqual(["VIEW_KIND_MISSING"]);
    expect(validateModelStructure({ ...base, views: { a: { list: "Task", form: "Task" } } }).map((d) => d.code)).toEqual(["VIEW_KIND_CONFLICT"]);
  });

  it("suggests the key that was meant", () => {
    const [diagnostic] = validateModelStructure({ ...base, views: { a: { list: "Task", colums: ["title"] } } });
    expect(diagnostic).toMatchObject({ code: "UNKNOWN_KEY", hint: "Did you mean 'columns'?" });
  });

  it("accepts each kind with its own keys, and a template instance", () => {
    const views = {
      home: { dashboard: [{ kpi: "Open", count: "Task", where: "status == 'open'" }] },
      tasks: { list: "Task", columns: ["title"], filters: ["status"], open: "task" },
      task: { form: "Task", actions: [], sections: [["title"]] },
      board: { use: "std:masterDetail", with: { entity: "Task", columns: ["title"] } },
    };
    expect(validateModelStructure({ ...base, views })).toEqual([]);
    expect(Object.keys(compile({ ...base, views } as never).views ?? {})).toEqual(["home", "tasks", "task", "board"]);
  });
});

describe("a query's where written as text", () => {
  it("is lowered to the tuple form the stores evaluate", () => {
    const kir = compile({ ...base, queries: { open: { from: "Task", where: "status == 'open'" } } } as never);
    expect(kir.queries?.open?.where).toEqual(["==", ["get", "status"], ["literal", "open"]]);
  });

  it("keeps a where that is already a tuple", () => {
    const where = ["==", ["get", "status"], "open"];
    expect(compile({ ...base, queries: { open: { from: "Task", where } } } as never).queries?.open?.where).toEqual(where);
  });

  it("is a diagnostic at the query when no store could evaluate it", () => {
    const diagnostics = diagnosticsOf({ ...base, queries: { mine: { from: "Task", where: "user.id == 'x'" } } });
    expect(diagnostics).toEqual([expect.objectContaining({ code: "QUERY_WHERE_INVALID", path: "/queries/mine/where" })]);
  });
});
