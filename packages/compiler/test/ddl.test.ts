import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compile, generateDDL } from "../src/index.js";

describe("SQL DDL Generator", () => {
  const examplesDir = resolve(__dirname, "../../../examples");

  it("generates PostgreSQL DDL for invoicing model", () => {
    const raw = readFileSync(resolve(examplesDir, "invoicing.kerangka.json"), "utf8");
    const kir = compile(raw);
    const ddl = generateDDL(kir, { dialect: "postgres" });

    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS customer");
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS invoice");
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS line");

    // Exact decimal types
    expect(ddl).toContain("credit_limit NUMERIC(12, 2)");
    expect(ddl).toContain("unit_price NUMERIC(12, 2)");

    // Enum check constraint
    expect(ddl).toContain("CHECK (status IN ('draft', 'sent', 'paid', 'void'))");

    // Foreign key constraint
    expect(ddl).toContain("CONSTRAINT fk_invoice_customer FOREIGN KEY (customer) REFERENCES customer (id)");

    // Audit columns
    expect(ddl).toContain("created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP");
  });

  it("generates SQLite DDL for multitenant inventory model", () => {
    const raw = readFileSync(resolve(examplesDir, "inventory.kerangka.json"), "utf8");
    const kir = compile(raw);
    const ddl = generateDDL(kir, { dialect: "sqlite" });

    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS stock_item");

    // Multitenant composite primary key
    expect(ddl).toContain("tenant_id VARCHAR(64) NOT NULL");
    expect(ddl).toContain("CONSTRAINT pk_stock_item PRIMARY KEY (tenant_id, sku)");
    expect(ddl).toContain("CREATE INDEX IF NOT EXISTS idx_stock_item_tenant ON stock_item (tenant_id);");

    // Check constraint on min
    expect(ddl).toContain("quantity INTEGER NOT NULL CHECK (quantity >= 0)");

    // SQLite audit timestamp
    expect(ddl).toContain("created_at TEXT NOT NULL DEFAULT (datetime('now'))");
  });
});
