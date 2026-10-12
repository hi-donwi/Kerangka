/**
 * Template instances: `{ "use": "<template>", "with": {...} }` at a workflow, an action, or a
 * view (PLAN.md §7.5). Before this, `@kerangka/std` shipped templates that the resolver
 * registered and the lockfile listed, and nothing ever expanded: a model could not use one.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Engine } from "@kerangka/engine-ts";
import { compile, generateUIDL } from "../src/index.js";
import { CompilerError, type CompilerDiagnostic, type RawKerangkaDocument } from "../src/types.js";
import { validateModelStructure } from "../src/meta-schema.js";

/** An expense claim whose lifecycle is the standard approval workflow. */
const expenseModel = (workflow: unknown = {
  use: "std:approval",
  with: { submitter: "employee", approver: "manager" },
}): RawKerangkaDocument => ({
  kerangka: "0.1",
  app: "expenses",
  roles: ["employee", "manager"],
  entities: {
    Expense: {
      fields: {
        id: "uuid",
        amount: "decimal(12,2)! >= 0",
        status: "enum(draft, submitted, approved, rejected) = draft",
      },
      workflow,
    },
  },
} as unknown as RawKerangkaDocument);

function diagnosticsOf(doc: unknown, sourcePath?: string): CompilerDiagnostic[] {
  try {
    compile(doc as RawKerangkaDocument, sourcePath ? { sourcePath } : undefined);
  } catch (err) {
    if (err instanceof CompilerError) return err.diagnostics;
    throw err;
  }
  throw new Error("expected the document not to compile");
}

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A model beside a local package whose manifest declares the given templates. */
function withLocalPackage(templates: Record<string, unknown>, doc: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kerangka-templates-"));
  tempDirs.push(dir);
  fs.mkdirSync(path.join(dir, "pack"));
  fs.writeFileSync(
    path.join(dir, "pack", "kerangka.json"),
    JSON.stringify({ package: "@acme/pack", version: "1.0.0", templates })
  );
  const modelPath = path.join(dir, "model.kerangka.json");
  fs.writeFileSync(modelPath, JSON.stringify({ ...doc, packages: { "@acme/pack": "file:./pack" } }));
  return modelPath;
}

describe("a workflow template", () => {
  it("expands std:approval into the entity's workflow", () => {
    const workflow = compile(expenseModel()).entities.Expense!.workflow!;

    expect(workflow.initial).toBe("draft");
    expect(workflow.states).toEqual(["draft", "submitted", "approved", "rejected"]);
    expect(Object.keys(workflow.transitions)).toEqual(["submit", "approve", "reject"]);
    expect(workflow.transitions.submit).toMatchObject({ from: "draft", to: "submitted", roles: ["employee"] });
    expect(workflow.transitions.approve).toMatchObject({ from: "submitted", to: "approved", roles: ["manager"] });
    expect(workflow.transitions.reject).toMatchObject({ from: "submitted", to: "rejected", roles: ["manager"] });
  });

  it("runs in the engine with the roles the arguments named", () => {
    const engine = new Engine(compile(expenseModel()));
    const employee = { id: "u-1", roles: ["employee"] };
    const manager = { id: "u-2", roles: ["manager"] };
    const draft = { id: "e-1", amount: "12.50", status: "draft" };

    const submitted = engine.run("Expense", "submit", draft, {}, employee);
    expect(submitted.ok).toBe(true);
    expect(submitted.record?.status).toBe("submitted");

    // The template gave `approve` to the approver role only.
    expect(engine.run("Expense", "approve", submitted.record!, {}, employee).ok).toBe(false);
    const approved = engine.run("Expense", "approve", submitted.record!, {}, manager);
    expect(approved.ok).toBe(true);
    expect(approved.record?.status).toBe("approved");
  });

  it("resolves the package-qualified name too", () => {
    const workflow = compile(
      expenseModel({ use: "@kerangka/std:approval", with: { submitter: "employee", approver: "manager" } })
    ).entities.Expense!.workflow!;
    expect(workflow.transitions.approve?.roles).toEqual(["manager"]);
  });

  it("takes a transition written beside 'use' as an addition", () => {
    const workflow = compile(
      expenseModel({
        use: "std:approval",
        with: { submitter: "employee", approver: "manager" },
        transitions: { reopen: { from: "rejected", to: "draft", roles: ["employee"] } },
      })
    ).entities.Expense!.workflow!;
    expect(Object.keys(workflow.transitions)).toEqual(["submit", "approve", "reject", "reopen"]);
  });

  it("refuses to let a local transition override the template's", () => {
    const diagnostics = diagnosticsOf(
      expenseModel({
        use: "std:approval",
        with: { submitter: "employee", approver: "manager" },
        transitions: { approve: { from: "submitted", to: "approved", roles: ["employee"] } },
      })
    );
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "TEMPLATE_KEY_CONFLICT",
        path: "/entities/Expense/workflow/transitions/approve",
      }),
    ]);
  });

  it("refuses a scalar key written beside 'use' that the template defines", () => {
    const diagnostics = diagnosticsOf(
      expenseModel({ use: "std:approval", with: { submitter: "a", approver: "b" }, initial: "submitted" })
    );
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "TEMPLATE_KEY_CONFLICT", path: "/entities/Expense/workflow/initial" }),
    ]);
  });

  it("does not modify the document it was given", () => {
    const doc = expenseModel();
    compile(doc);
    expect((doc.entities!.Expense as { workflow: unknown }).workflow).toEqual({
      use: "std:approval",
      with: { submitter: "employee", approver: "manager" },
    });
  });
});

describe("an instance that cannot expand is a diagnostic at the instance", () => {
  it("names an unknown template and suggests the closest one", () => {
    const diagnostics = diagnosticsOf(expenseModel({ use: "std:aproval", with: {} }));
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "TEMPLATE_UNKNOWN",
        path: "/entities/Expense/workflow/use",
        hint: "Did you mean 'std:approval'?",
      }),
    ]);
  });

  it("refuses a view template standing at a workflow", () => {
    const diagnostics = diagnosticsOf(expenseModel({ use: "std:masterDetail", with: { entity: "Expense", columns: [] } }));
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "TEMPLATE_KIND_MISMATCH", path: "/entities/Expense/workflow/use" }),
    ]);
  });

  it("names a missing argument and an argument the template does not take", () => {
    const diagnostics = diagnosticsOf(expenseModel({ use: "std:approval", with: { submitter: "employee", aprover: "manager" } }));
    expect(diagnostics.map((d) => [d.code, d.path])).toEqual([
      ["TEMPLATE_PARAM_UNKNOWN", "/entities/Expense/workflow/with/aprover"],
      ["TEMPLATE_PARAM_MISSING", "/entities/Expense/workflow/with"],
    ]);
  });

  it("holds the expansion to the structural layer, so a list where a role goes is caught", () => {
    // `roles: ["${approver}"]` with a list argument becomes a list inside a list: a role that
    // matches nobody, silently, unless the expansion is checked like hand-written input.
    const diagnostics = diagnosticsOf(
      expenseModel({ use: "std:approval", with: { submitter: "employee", approver: ["manager", "director"] } })
    );
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "SCHEMA_INVALID",
        path: "/entities/Expense/workflow/transitions/approve/roles/0",
        message: expect.stringContaining("(in the expansion of template 'std:approval')"),
      }),
      expect.objectContaining({
        code: "SCHEMA_INVALID",
        path: "/entities/Expense/workflow/transitions/reject/roles/0",
      }),
    ]);
  });

  it("locates a diagnostic inside an expansion at the instance in the source text", () => {
    const text = JSON.stringify(expenseModel({ use: "std:approval", with: { submitter: "employee" } }), null, 2);
    try {
      compile(text);
      throw new Error("expected a diagnostic");
    } catch (err) {
      const [diagnostic] = (err as CompilerError).diagnostics;
      expect(diagnostic?.code).toBe("TEMPLATE_PARAM_MISSING");
      const line = text.split("\n").findIndex((l) => l.includes('"with"')) + 1;
      expect(diagnostic?.line).toBe(line);
    }
  });
});

describe("the structural layer reads an instance as an instance", () => {
  it("accepts 'use' and 'with' at a workflow and at an action", () => {
    const doc = expenseModel();
    (doc.entities!.Expense as unknown as Record<string, unknown>).actions = {
      archive: { use: "@acme/pack:archive", with: { role: "manager" } },
    };
    expect(validateModelStructure(doc)).toEqual([]);
  });

  it("still reports a typo beside 'use'", () => {
    const codes = validateModelStructure(expenseModel({ use: "std:approval", with: {}, transisions: {} }));
    expect(codes).toEqual([expect.objectContaining({ code: "UNKNOWN_KEY", path: "/entities/Expense/workflow/transisions" })]);
  });

  it("reports 'use' that names nothing and 'with' that is not an object", () => {
    const codes = validateModelStructure(expenseModel({ use: 7, with: "manager" })).map((d) => [d.code, d.path]);
    expect(codes).toEqual([
      ["SCHEMA_INVALID", "/entities/Expense/workflow/use"],
      ["SCHEMA_INVALID", "/entities/Expense/workflow/with"],
    ]);
  });
});

describe("a view template", () => {
  it("expands std:masterDetail into a list view the UIDL projector renders", () => {
    const doc = {
      ...expenseModel(),
      views: { expenses: { use: "std:masterDetail", with: { entity: "Expense", columns: ["amount", "status"] } } },
    } as RawKerangkaDocument;
    const kir = compile(doc);
    expect(kir.views).toEqual({ expenses: { list: "Expense", columns: ["amount", "status"] } });

    const screens = generateUIDL(kir);
    expect(screens.expenses?.route).toBe("/expenses");
    // A custom list for Expense replaces the scaffolded one.
    expect(screens["expense-list"]).toBeUndefined();
  });
});

describe("an action template from a local package", () => {
  const pack = {
    archive: {
      template: "archive",
      type: "action",
      params: { role: {}, state: { default: "approved" } },
      roles: ["${role}"],
      when: "status == '${state}'",
      run: { archived: true },
    },
    misspelled: {
      template: "misspelled",
      type: "action",
      params: [],
      rols: ["manager"],
    },
  };

  const model = (actions: Record<string, unknown>) => ({
    kerangka: "0.1",
    app: "expenses",
    entities: {
      Expense: {
        fields: { id: "uuid", status: "enum(draft, approved) = draft", archived: "bool = false" },
        actions,
      },
    },
  });

  it("expands with a default argument and runs", () => {
    const modelPath = withLocalPackage(pack, model({ archive: { use: "@acme/pack:archive", with: { role: "manager" } } }));
    const kir = compile(fs.readFileSync(modelPath, "utf8"), { sourcePath: modelPath });
    expect(kir.entities.Expense!.actions!.archive!.roles).toEqual(["manager"]);

    const engine = new Engine(kir);
    const manager = { id: "u-2", roles: ["manager"] };
    expect(engine.run("Expense", "archive", { id: "e-1", status: "draft", archived: false }, {}, manager).ok).toBe(false);
    const result = engine.run("Expense", "archive", { id: "e-1", status: "approved", archived: false }, {}, manager);
    expect(result.ok).toBe(true);
    expect(result.record?.archived).toBe(true);
  });

  it("reports a typo in the package's template as a typo in the expansion", () => {
    const modelPath = withLocalPackage(pack, model({ check: { use: "pack:misspelled" } }));
    const diagnostics = diagnosticsOf(fs.readFileSync(modelPath, "utf8"), modelPath);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "UNKNOWN_KEY",
        path: "/entities/Expense/actions/check/rols",
        message: expect.stringContaining("(in the expansion of template 'pack:misspelled')"),
      }),
    ]);
  });
});

describe("an entity template from an official pack", () => {
  const accounts = (entities: Record<string, unknown>, packages: Record<string, string> = { "@kerangka/identity": "^0.1" }) =>
    ({ kerangka: "0.1", app: "accounts", roles: ["owner", "admin", "member"], packages, entities }) as unknown as RawKerangkaDocument;

  it("places identity:member and identity:organization under the names the document gives", () => {
    const kir = compile(accounts({ Company: { use: "identity:organization" }, Staff: { use: "identity:member", with: { organization: "Company" } } }));
    expect(kir.entities.Staff!.fields.organization).toMatchObject({ type: "ref", target: "Company" });
    expect(kir.entities.Staff!.fields.role).toMatchObject({ type: "enum", values: ["owner", "admin", "member"] });
    expect(Object.keys(kir.entities.Staff!.workflow!.transitions)).toEqual(["accept", "suspend", "reactivate"]);
    expect(kir.entities.Company!.fields.createdAt).toBeDefined(); // std:auditable came with it
  });

  it("runs the pack's rules: nobody suspends the owner, and only the owner changes roles", () => {
    const engine = new Engine(compile(accounts({ Organization: { use: "identity:organization" }, Member: { use: "identity:member" } })));
    const admin = { id: "u-a", roles: ["admin"] };
    const owner = { id: "u-o", roles: ["owner"] };
    const active = (role: string) => ({ organization: "org-1", email: "x@example.com", role, status: "active" });
    expect(engine.run("Member", "suspend", active("member"), {}, admin).ok).toBe(true);
    expect(engine.run("Member", "suspend", active("owner"), {}, admin).ok).toBe(false);
    expect(engine.run("Member", "changeRole", active("member"), { newRole: "admin" }, admin).ok).toBe(false);
    const promoted = engine.run("Member", "changeRole", active("member"), { newRole: "admin" }, owner);
    expect(promoted.ok).toBe(true);
    expect(promoted.record?.role).toBe("admin");
  });

  it("takes role names as arguments", () => {
    const kir = compile(
      accounts({ Organization: { use: "identity:organization", with: { ownerRole: "founder", readers: ["founder"] } }, Member: { use: "identity:member", with: { ownerRole: "founder" } } })
    );
    expect(kir.entities.Member!.fields.role).toMatchObject({ values: ["founder", "admin", "member"] });
    expect(kir.entities.Member!.actions!.changeRole!.roles).toEqual(["founder"]);
    expect(kir.entities.Organization!.permissions).toMatchObject({ read: ["founder"], update: ["founder"] });
  });

  it("adds a field written beside 'use', and refuses one the template already has", () => {
    const added = compile(accounts({ Organization: { use: "identity:organization" }, Member: { use: "identity:member", fields: { phone: "string" } } }));
    expect(added.entities.Member!.fields.phone).toBeDefined();
    const diagnostics = diagnosticsOf(accounts({ Organization: { use: "identity:organization" }, Member: { use: "identity:member", fields: { email: "string" } } }));
    expect(diagnostics).toEqual([expect.objectContaining({ code: "TEMPLATE_KEY_CONFLICT", path: "/entities/Member/fields/email" })]);
  });

  it("is unknown until the document names the pack", () => {
    const diagnostics = diagnosticsOf(accounts({ Member: { use: "identity:member" } }, {}));
    expect(diagnostics).toEqual([expect.objectContaining({ code: "TEMPLATE_UNKNOWN", path: "/entities/Member/use" })]);
  });

  it("refuses an entity template standing where a workflow goes", () => {
    const diagnostics = diagnosticsOf(accounts({ Member: { fields: { email: "email!" }, workflow: { use: "identity:member" } } }));
    expect(diagnostics).toEqual([expect.objectContaining({ code: "TEMPLATE_KIND_MISMATCH", path: "/entities/Member/workflow/use" })]);
  });

  it("keeps the audit trail append-only", () => {
    const engine = new Engine(compile(accounts({ AuditEntry: { use: "admin:auditEntry" } }, { "@kerangka/admin": "^0.1" })));
    const admin = { id: "u-a", roles: ["admin"] };
    expect(engine.canOperate("AuditEntry", "read", admin).allowed).toBe(true);
    expect(engine.canOperate("AuditEntry", "update", admin).allowed).toBe(false);
    expect(engine.canOperate("AuditEntry", "delete", admin).allowed).toBe(false);
  });
});

describe("an entity template from a local package", () => {
  const pack = {
    claim: {
      template: "claim",
      type: "entity",
      params: [],
      fields: { amount: "decimal(12,2)! >= 0", status: "enum(draft, submitted, approved, rejected) = draft" },
    },
    nested: {
      template: "nested",
      type: "entity",
      params: [],
      fields: { status: "enum(draft, submitted, approved, rejected) = draft" },
      workflow: { use: "std:approval", with: { submitter: "a", approver: "b" } },
    },
  };

  it("composes with a workflow instance written beside 'use'", () => {
    const modelPath = withLocalPackage(pack, {
      kerangka: "0.1",
      app: "claims",
      entities: { Claim: { use: "@acme/pack:claim", workflow: { use: "std:approval", with: { submitter: "staff", approver: "manager" } } } },
    });
    const kir = compile(fs.readFileSync(modelPath, "utf8"), { sourcePath: modelPath });
    expect(kir.entities.Claim!.fields.amount).toMatchObject({ type: "decimal" });
    expect(kir.entities.Claim!.workflow!.transitions.approve?.roles).toEqual(["manager"]);
  });

  it("refuses an entity template that contains an instance: templates do not nest", () => {
    const modelPath = withLocalPackage(pack, { kerangka: "0.1", app: "claims", entities: { Claim: { use: "pack:nested" } } });
    const diagnostics = diagnosticsOf(fs.readFileSync(modelPath, "utf8"), modelPath);
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "TEMPLATE_INVALID", path: "/entities/Claim/use", message: expect.stringContaining("'/workflow'") }),
    ]);
  });

  it("is still checked for typos beside 'use'", () => {
    const codes = validateModelStructure({ kerangka: "0.1", app: "x", entities: { Claim: { use: "pack:claim", feilds: {} } } });
    expect(codes).toEqual([expect.objectContaining({ code: "UNKNOWN_KEY", path: "/entities/Claim/feilds" })]);
  });
});
