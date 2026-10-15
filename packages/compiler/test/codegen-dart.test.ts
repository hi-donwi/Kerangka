import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { compile, generateCode, DartCodegen } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const invoicingPath = path.resolve(__dirname, "../../../examples/invoicing.kerangka.json");
const invoicingSource = fs.readFileSync(invoicingPath, "utf-8");

describe("Dart Code Generation", () => {
  const kir = compile(invoicingSource);

  it("generates valid Dart classes via generateCode target 'dart'", () => {
    const dartCode = generateCode(kir, "dart");

    // Classes
    expect(dartCode).toContain("class Invoice {");
    expect(dartCode).toContain("class Customer {");
    expect(dartCode).toContain("class Line {");

    // Enum generation
    expect(dartCode).toContain("enum InvoiceStatus {");
    expect(dartCode).toContain("draft,");
    expect(dartCode).toContain("sent,");
    expect(dartCode).toContain("paid,");
    expect(dartCode).toContain("void_;");
    expect(dartCode).toContain("static InvoiceStatus fromJson(String value)");

    // Fields
    expect(dartCode).toContain("final String number;");
    expect(dartCode).toContain("final Customer customer;");
    expect(dartCode).toContain("final InvoiceStatus? status;");
    expect(dartCode).toContain("final List<Line>? lines;");
    // A decimal is a JSON string on the wire (ADR-0004), not a `double`.
    expect(dartCode).toContain("final String unitPrice;");
    expect(dartCode).toContain("unitPrice: json['unitPrice'] as String?,");

    // Serialization
    expect(dartCode).toContain("factory Invoice.fromJson(Map<String, dynamic> json)");
    expect(dartCode).toContain("Map<String, dynamic> toJson()");
  });

  it("sanitizes Dart keywords in field names", () => {
    const modelWithKeyword = JSON.stringify({
      kerangka: "0.1",
      app: "keyword-test",
      entities: {
        Item: {
          fields: {
            assert: "string!",
            switch: "bool",
            default: "string"
          }
        }
      }
    });

    const parsedKir = compile(modelWithKeyword);
    const dartCode = DartCodegen.generate(parsedKir);

    expect(dartCode).toContain("final String assert_;");
    expect(dartCode).toContain("final bool? switch_;");
    expect(dartCode).toContain("final String? default_;");
  });
});
