import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  compile,
  DBMigrationDiffer,
  KIRDocument,
  loadSqlSchemaSource,
  loadSqliteSchema,
  parseSqlSchema,
  sqlTypeToFieldType,
  toCamelCase,
  toPascalCase,
} from "../src/index.js";

const examplesDir = resolve(__dirname, "../../../examples");
const tmpDir = mkdtempSync(join(tmpdir(), "kerangka-db-diff-"));

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function compileExample(name: string): KIRDocument {
  const raw = readFileSync(resolve(examplesDir, name), "utf8");
  return compile(raw);
}

describe("SQL Migration Differ", () => {
  it("emits CREATE TABLE steps for added entities (expand phase)", () => {
    const oldKir = compileExample("invoicing.kerangka.json");
    const newKir = compileExample("todo.kerangka.json");
    const result = DBMigrationDiffer.diff(oldKir, newKir, { dialect: "postgres" });

    expect(result.summary.tablesCreated).toBeGreaterThan(0);
    expect(result.steps.some((s) => s.type === "create_table" && s.phase === "expand")).toBe(true);
    expect(result.sql).toContain("CREATE TABLE IF NOT EXISTS");
  });

  it("emits DROP TABLE steps for removed entities as destructive contract steps", () => {
    const oldKir = compileExample("todo.kerangka.json");
    const newKir = compileExample("invoicing.kerangka.json");
    const result = DBMigrationDiffer.diff(oldKir, newKir, { dialect: "postgres" });

    expect(result.summary.tablesDropped).toBeGreaterThan(0);
    expect(result.hasDestructiveSteps).toBe(true);
    expect(result.steps.some((s) => s.type === "drop_table" && s.phase === "contract")).toBe(true);
    expect(result.sql).toContain("DROP TABLE IF EXISTS");
    expect(result.sql).toContain("WARNING: DESTRUCTIVE OPERATIONS DETECTED");
  });

  it("adds new nullable columns as non-destructive expand steps", () => {
    const oldKir = compileExample("invoicing.kerangka.json");
    const newKir = JSON.parse(JSON.stringify(oldKir)) as KIRDocument;
    newKir.entities["Invoice"]!.fields["discountCode"] = { type: "string", required: false };

    const result = DBMigrationDiffer.diff(oldKir, newKir, { dialect: "postgres" });
    const add = result.steps.find((s) => s.type === "add_column" && s.column === "discount_code");

    expect(add).toBeDefined();
    expect(add!.destructive).toBe(false);
    expect(add!.phase).toBe("expand");
    expect(add!.sql).toContain("ADD COLUMN discount_code TEXT");
  });

  it("marks a required column without default as destructive", () => {
    const oldKir = compileExample("invoicing.kerangka.json");
    const newKir = JSON.parse(JSON.stringify(oldKir)) as KIRDocument;
    newKir.entities["Invoice"]!.fields["taxId"] = { type: "string", required: true };

    const result = DBMigrationDiffer.diff(oldKir, newKir, { dialect: "postgres" });
    const add = result.steps.find((s) => s.type === "add_column" && s.column === "tax_id");

    expect(add).toBeDefined();
    expect(add!.destructive).toBe(true);
  });

  it("detects type and nullability changes as contract steps", () => {
    const oldKir = compileExample("invoicing.kerangka.json");
    const newKir = JSON.parse(JSON.stringify(oldKir)) as KIRDocument;
    newKir.entities["Invoice"]!.fields["paidAt"] = { type: "int", required: true };

    const result = DBMigrationDiffer.diff(oldKir, newKir, { dialect: "postgres" });

    expect(result.steps.some((s) => s.type === "alter_column_type")).toBe(true);
    expect(result.steps.some((s) => s.type === "alter_column_nullability")).toBe(true);
    expect(result.summary.columnsModified).toBeGreaterThanOrEqual(2);
  });

  it("generates CREATE INDEX for added reference columns", () => {
    const oldKir = compileExample("invoicing.kerangka.json");
    const newKir = JSON.parse(JSON.stringify(oldKir)) as KIRDocument;
    newKir.entities["Invoice"]!.fields["approver"] = {
      type: "ref",
      required: false,
      target: "Customer",
    };

    const result = DBMigrationDiffer.diff(oldKir, newKir, { dialect: "postgres" });
    const index = result.steps.find(
      (s) => s.type === "create_index" && s.column === "approver"
    );

    expect(index).toBeDefined();
    expect(index!.sql).toContain("CREATE INDEX IF NOT EXISTS idx_invoice_approver ON invoice (approver);");
  });

  it("drops the reference index when a reference column is removed", () => {
    const oldKir = compileExample("invoicing.kerangka.json");
    const newKir = JSON.parse(JSON.stringify(oldKir)) as KIRDocument;
    delete newKir.entities["Invoice"]!.fields["customer"];

    const result = DBMigrationDiffer.diff(oldKir, newKir, { dialect: "postgres" });

    expect(result.steps.some((s) => s.type === "drop_index")).toBe(true);
    expect(result.steps.some((s) => s.type === "drop_column" && s.column === "customer")).toBe(true);
  });

  it("turns renamedFrom into RENAME COLUMN instead of drop+add", () => {
    const oldKir = compileExample("invoicing.kerangka.json");
    const newKir = JSON.parse(JSON.stringify(oldKir)) as KIRDocument;
    delete newKir.entities["Invoice"]!.fields["paidAt"];
    newKir.entities["Invoice"]!.fields["remarks"] = {
      type: "string",
      required: false,
      renamedFrom: "paidAt",
    };

    const result = DBMigrationDiffer.diff(oldKir, newKir, { dialect: "postgres" });

    expect(result.summary.columnsRenamed).toBe(1);
    const rename = result.steps.find((s) => s.type === "rename_column");
    expect(rename).toBeDefined();
    expect(rename!.sql).toContain("ALTER TABLE invoice RENAME COLUMN paid_at TO remarks;");
    expect(result.steps.some((s) => s.type === "add_column" && s.column === "remarks")).toBe(false);
    expect(result.steps.some((s) => s.type === "drop_column" && s.column === "paid_at")).toBe(false);
  });

  it("respects --phase expand and --phase contract filtering", () => {
    const oldKir = compileExample("todo.kerangka.json");
    const newKir = compileExample("invoicing.kerangka.json");

    const expand = DBMigrationDiffer.diff(oldKir, newKir, { phase: "expand" });
    const contract = DBMigrationDiffer.diff(oldKir, newKir, { phase: "contract" });

    expect(expand.steps.every((s) => s.phase === "expand")).toBe(true);
    expect(contract.steps.every((s) => s.phase === "contract")).toBe(true);
    expect(expand.steps.some((s) => s.type === "create_table")).toBe(true);
    expect(contract.steps.some((s) => s.type === "drop_table")).toBe(true);
  });

  it("orders expand steps before contract steps in the full migration", () => {
    const oldKir = compileExample("todo.kerangka.json");
    const newKir = compileExample("invoicing.kerangka.json");
    const result = DBMigrationDiffer.diff(oldKir, newKir, { phase: "all" });

    const firstContract = result.steps.findIndex((s) => s.phase === "contract");
    const lastExpand = result.steps.map((s) => s.phase).lastIndexOf("expand");
    expect(firstContract).toBeGreaterThan(lastExpand);
    expect(result.sql).toContain("Phase: EXPAND (Phase A: Backward-compatible)");
  });

  it("generates SQLite dialect SQL with SQLite-specific defaults", () => {
    const oldKir = compileExample("invoicing.kerangka.json");
    const newKir = JSON.parse(JSON.stringify(oldKir)) as KIRDocument;
    newKir.entities["Invoice"]!.fields["archivedAt"] = { type: "datetime", required: false };

    const result = DBMigrationDiffer.diff(oldKir, newKir, { dialect: "sqlite" });
    const add = result.steps.find((s) => s.type === "add_column" && s.column === "archived_at");

    expect(add).toBeDefined();
    expect(add!.sql).toContain("archived_at TEXT");
  });

  it("supports enum values and unique constraints on added columns", () => {
    const oldKir = compileExample("invoicing.kerangka.json");
    const newKir = JSON.parse(JSON.stringify(oldKir)) as KIRDocument;
    newKir.entities["Invoice"]!.fields["priority"] = {
      type: "enum",
      required: false,
      values: ["low", "high"],
    };
    newKir.entities["Invoice"]!.fields["externalRef"] = {
      type: "string",
      required: false,
      unique: true,
    };

    const result = DBMigrationDiffer.diff(oldKir, newKir, { dialect: "postgres" });
    expect(result.sql).toContain("CHECK (priority IN ('low', 'high'))");
    expect(result.sql).toContain("external_ref TEXT UNIQUE");
  });

  it("reports a summary and no-op migration for identical models", () => {
    const kir = compileExample("invoicing.kerangka.json");
    const result = DBMigrationDiffer.diff(kir, JSON.parse(JSON.stringify(kir)));

    expect(result.steps.length).toBe(0);
    expect(result.hasDestructiveSteps).toBe(false);
    expect(result.summary.destructiveCount).toBe(0);
    expect(result.sql).toContain("No schema changes detected.");
  });
});

describe("SQL schema parsing and type mapping", () => {
  it("parses CREATE TABLE statements with constraints and defaults", () => {
    const sql = `
-- a comment line
CREATE TABLE IF NOT EXISTS tbl_invoice (
  id VARCHAR(64) PRIMARY KEY,
  inv_no VARCHAR(64) NOT NULL,
  total NUMERIC(12, 2) DEFAULT 0,
  is_paid BOOLEAN DEFAULT FALSE,
  due DATE,
  note TEXT,
  CONSTRAINT pk_invoice PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS line (
  id TEXT PRIMARY KEY,
  qty INTEGER NOT NULL DEFAULT 3
);
`;
    const tables = parseSqlSchema(sql);
    expect(tables.map((t) => t.name)).toEqual(["tbl_invoice", "line"]);
    const invoice = tables[0]!;
    expect(invoice.columns.map((c) => c.name)).toEqual([
      "id",
      "inv_no",
      "total",
      "is_paid",
      "due",
      "note",
    ]);
    const total = invoice.columns.find((c) => c.name === "total")!;
    expect(total.notNull).toBe(false);
    expect(total.default).toBe("0");
  });

  it("maps SQL types onto Kerangka field types", () => {
    expect(sqlTypeToFieldType("INTEGER", "quantity").type).toBe("int");
    expect(sqlTypeToFieldType("NUMERIC(12, 2)", "total").type).toBe("decimal");
    expect(sqlTypeToFieldType("BOOLEAN", "is_paid").type).toBe("boolean");
    expect(sqlTypeToFieldType("TIMESTAMPTZ", "created_at").type).toBe("datetime");
    expect(sqlTypeToFieldType("TEXT", "created_at").type).toBe("datetime");
    expect(sqlTypeToFieldType("TEXT", "id").type).toBe("uuid");
    expect(sqlTypeToFieldType("TEXT", "customer_id").type).toBe("uuid");
    expect(sqlTypeToFieldType("TEXT", "note").type).toBe("string");
    expect(sqlTypeToFieldType("JSONB", "payload").type).toBe("list");
  });

  it("normalizes snake_case columns and table names", () => {
    expect(toCamelCase("inv_no")).toBe("invNo");
    expect(toCamelCase("tbl_invoice")).toBe("invoice");
    expect(toPascalCase("stock_item")).toBe("StockItem");
  });

  it("drafts a KIR document from a SQL schema and diffs it against a model", () => {
    const sql = `
CREATE TABLE invoice (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  total NUMERIC(12, 2)
);
`;
    const kir = loadSqlSchemaSource(sql);
    expect(Object.keys(kir.entities)).toEqual(["Invoice"]);

    const newKir = compileExample("invoicing.kerangka.json");
    const result = DBMigrationDiffer.diff(kir, newKir, { dialect: "sqlite" });
    expect(result.sql).toContain("ALTER TABLE invoice ADD COLUMN");
  });
});

describe("SQLite database introspection", () => {
  it("loads entities from a real SQLite database file", async () => {
    const dbPath = join(tmpDir, "legacy.sqlite");
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbPath);
    try {
      db.exec(`
        CREATE TABLE invoice (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          total NUMERIC(12, 2) DEFAULT 0
        );
        CREATE TABLE line (
          id TEXT PRIMARY KEY,
          invoice_id TEXT,
          qty INTEGER NOT NULL DEFAULT 1
        );
      `);
    } finally {
      db.close();
    }

    const kir = await loadSqliteSchema(dbPath);
    expect(Object.keys(kir.entities).sort()).toEqual(["Invoice", "Line"]);
    expect(kir.entities["Invoice"]!.key).toBe("id");
    expect(kir.entities["Invoice"]!.fields["status"]!.required).toBe(true);
    expect(kir.entities["Invoice"]!.fields["total"]!.default).toBe(0);
    expect(kir.entities["Line"]!.fields["invoiceId"]!.type).toBe("uuid");
  });
});
