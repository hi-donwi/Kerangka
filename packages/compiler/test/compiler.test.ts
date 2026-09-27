import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  compile,
  CompilerError,
  parseFieldShorthand,
} from "../src/index.js";

describe("Compiler - Field Shorthand Parser", () => {
  it("parses required and optional primitive fields", () => {
    expect(parseFieldShorthand("string!")).toEqual({
      type: "string",
      required: true,
    });
    expect(parseFieldShorthand("int?")).toEqual({
      type: "int",
      required: false,
    });
    expect(parseFieldShorthand("boolean")).toEqual({
      type: "boolean",
      required: false,
    });
  });

  it("parses unique flags and default values", () => {
    expect(parseFieldShorthand("string! unique")).toEqual({
      type: "string",
      required: true,
      unique: true,
    });
    expect(parseFieldShorthand("int! >= 0 = 0")).toEqual({
      type: "int",
      required: true,
      min: 0,
      default: 0,
    });
  });

  it("parses entity references and lists", () => {
    expect(parseFieldShorthand("ref(Customer)!")).toEqual({
      type: "ref",
      target: "Customer",
      required: true,
    });
    expect(parseFieldShorthand("list(Line)")).toEqual({
      type: "list",
      element: {
        type: "ref",
        target: "Line",
        required: true,
      },
      required: false,
    });
  });

  it("parses enums and decimals with precision/scale", () => {
    expect(parseFieldShorthand("enum(draft, sent, paid) = draft")).toEqual({
      type: "enum",
      values: ["draft", "sent", "paid"],
      required: false,
      default: "draft",
    });
    expect(parseFieldShorthand("decimal(12,2)! >= 0")).toEqual({
      type: "decimal",
      precision: 12,
      scale: 2,
      required: true,
      min: 0,
    });
  });
});

describe("Compiler - Document Pipeline", () => {
  const examplesDir = resolve(__dirname, "../../../examples");

  it("compiles todo.kerangka.json without error", () => {
    const raw = readFileSync(resolve(examplesDir, "todo.kerangka.json"), "utf8");
    const kir = compile(raw);

    expect(kir.kir).toBe("0.1");
    expect(kir.app).toBe("todo");
    expect(kir.entities.Todo).toBeDefined();
    expect(kir.entities.Todo!.fields.title).toEqual({
      type: "string",
      required: true,
    });
    expect(kir.entities.Todo!.actions?.toggle).toBeDefined();
  });

  it("compiles invoicing.kerangka.json and transforms formulas to AST", () => {
    const raw = readFileSync(resolve(examplesDir, "invoicing.kerangka.json"), "utf8");
    const kir = compile(raw);

    expect(kir.app).toBe("invoicing");
    expect(kir.entities.Invoice).toBeDefined();

    // Check computed formula
    const totalField = kir.entities.Invoice!.fields.total;
    expect(typeof totalField?.compute).toBe("object");

    // Check rules AST
    const rule = kir.entities.Invoice!.rules?.[0];
    expect(rule?.id).toBe("due-after-issue");
    expect(typeof rule?.check).toBe("object");

    // Check workflow
    const workflow = kir.entities.Invoice!.workflow;
    expect(workflow).toBeDefined();
    expect(workflow!.states).toContain("draft");
    expect(workflow!.states).toContain("sent");
    expect(workflow!.states).toContain("paid");
  });

  it("compiles inventory.kerangka.json with multitenancy and invariants", () => {
    const raw = readFileSync(resolve(examplesDir, "inventory.kerangka.json"), "utf8");
    const kir = compile(raw);

    expect(kir.app).toBe("inventory");
    expect(kir.multitenancy).toEqual({
      strategy: "discriminator",
      field: "tenantId",
    });

    const stock = kir.entities.StockItem!;
    expect(stock.invariants).toHaveLength(1);
    expect(stock.invariants![0]!.id).toBe("quantity-exceeds-reserved");
    expect(typeof stock.invariants![0]!.assert).toBe("object");
  });

  it("compiles leave-request.kerangka.json with decisions and tasks", () => {
    const raw = readFileSync(resolve(examplesDir, "leave-request.kerangka.json"), "utf8");
    const kir = compile(raw);

    expect(kir.app).toBe("leave-request");
    expect(kir.decisions).toBeDefined();
    expect(kir.entities.LeaveRequest!.workflow?.tasks).toBeDefined();
  });

  it("fails when an unknown entity reference is encountered", () => {
    const invalidDoc = {
      kerangka: "0.1",
      app: "broken",
      entities: {
        Order: {
          fields: {
            customer: "ref(NonExistentCustomer)!",
          },
        },
      },
    };

    expect(() => compile(invalidDoc)).toThrowError(CompilerError);
  });
});
