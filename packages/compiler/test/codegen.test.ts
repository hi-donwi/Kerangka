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
  });

  it("generates valid Java 21 records", () => {
    const javaCode = generateCode(kir, "java", { packageName: "com.example.invoice" });
    expect(javaCode).toContain("package com.example.invoice;");
    expect(javaCode).toContain("public record Invoice(");
    expect(javaCode).toContain("public record Customer(");
    expect(javaCode).toContain("public enum InvoiceStatus {");
    expect(javaCode).toContain("List<Line> lines");
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
  });
});
