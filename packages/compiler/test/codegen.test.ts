import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { compile, generateCode } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const invoicingPath = path.resolve(__dirname, "../../../examples/invoicing.kerangka.json");
const invoicingSource = fs.readFileSync(invoicingPath, "utf-8");

describe("Multi-Language Code Generation", () => {
  const kir = compile(invoicingSource);

  it("generates valid TypeScript models", () => {
    const tsCode = generateCode(kir, "ts");
    expect(tsCode).toContain("export interface Invoice {");
    expect(tsCode).toContain("export interface Customer {");
    expect(tsCode).toContain("export interface Line {");
    expect(tsCode).toContain("export type InvoiceStatus = \"draft\" | \"sent\" | \"paid\" | \"void\";");
    expect(tsCode).toContain("lines?: Array<Line>;");
    // A decimal is a JSON string on the wire (ADR-0004), not a `number`.
    expect(tsCode).toContain("unitPrice: string;");
    expect(tsCode).toContain("total?: string;");
  });

  it("generates valid Java 21 records", () => {
    const javaCode = generateCode(kir, "java", { packageName: "com.example.invoice" });
    expect(javaCode).toContain("package com.example.invoice;");
    expect(javaCode).toContain("public record Invoice(");
    expect(javaCode).toContain("public record Customer(");
    expect(javaCode).toContain("public enum InvoiceStatus {");
    expect(javaCode).toContain("List<Line> lines");
    // A decimal crosses the wire as a string (ADR-0004): Jackson must not write
    // a BigDecimal as a number, and deserialization already accepts a string.
    expect(javaCode).toContain("import com.fasterxml.jackson.databind.annotation.JsonSerialize;");
    expect(javaCode).toContain("@JsonSerialize(using = ToStringSerializer.class) BigDecimal unitPrice");
  });

  it("generates valid Python models with Pydantic v2", () => {
    const pyCode = generateCode(kir, "python");
    expect(pyCode).toContain("class Invoice(BaseModel):");
    expect(pyCode).toContain("class Customer(BaseModel):");
    expect(pyCode).toContain("class InvoiceStatus(str, Enum):");
    expect(pyCode).toContain("lines: Optional[List[Line]] = None");
  });

  it("generates valid Go structs", () => {
    const goCode = generateCode(kir, "go", { packageName: "invoice" });
    expect(goCode).toContain("package invoice");
    expect(goCode).toContain("type Invoice struct {");
    expect(goCode).toContain("type Customer struct {");
    expect(goCode).toContain("type InvoiceStatus string");
    expect(goCode).toContain("Lines []Line `json:\"lines,omitempty\"`");
    // A decimal is a JSON string on the wire (ADR-0004): the generated model
    // wraps decimal.Decimal so it marshals as a string, never a number.
    expect(goCode).toContain("type Decimal struct {");
    expect(goCode).toContain("func (d Decimal) MarshalJSON() ([]byte, error) {");
    expect(goCode).toContain("json.Marshal(d.String())");
    expect(goCode).toContain("UnitPrice Decimal `json:\"unitPrice\"`");
    expect(goCode).toContain("Total *Decimal `json:\"total,omitempty\"`");
  });

  it("models a list of decimals as a wire string in Go and Java", () => {
    const kirList = {
      app: "orders",
      version: "0.1",
      entities: {
        Order: {
          fields: {
            amounts: { type: "list", required: true, element: { type: "decimal" } }
          }
        }
      }
    } as unknown as Parameters<typeof generateCode>[0];

    const goCode = generateCode(kirList, "go", { packageName: "model" });
    expect(goCode).toContain("Amounts []Decimal `json:\"amounts\"`");

    const javaCode = generateCode(kirList, "java", { packageName: "com.example.order" });
    expect(javaCode).toContain("@JsonSerialize(contentUsing = ToStringSerializer.class) List<BigDecimal> amounts");
  });
});
