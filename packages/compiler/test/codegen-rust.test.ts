import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { compile, generateCode, RustCodegen } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const invoicingPath = path.resolve(__dirname, "../../../examples/invoicing.kerangka.json");
const invoicingSource = fs.readFileSync(invoicingPath, "utf-8");

describe("Rust Code Generation", () => {
  const kir = compile(invoicingSource);

  it("generates valid Rust structs via generateCode target 'rust'", () => {
    const rustCode = generateCode(kir, "rust");

    // Imports
    expect(rustCode).toContain("use serde::{Deserialize, Serialize};");

    // Structs with Serde attributes
    expect(rustCode).toContain("#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]");
    expect(rustCode).toContain("#[serde(rename_all = \"camelCase\")]");
    expect(rustCode).toContain("pub struct Invoice {");
    expect(rustCode).toContain("pub struct Customer {");
    expect(rustCode).toContain("pub struct Line {");

    // Enum generation
    expect(rustCode).toContain("pub enum InvoiceStatus {");
    expect(rustCode).toContain("#[serde(rename = \"draft\")]");
    expect(rustCode).toContain("Draft,");
    expect(rustCode).toContain("#[serde(rename = \"sent\")]");
    expect(rustCode).toContain("Sent,");
    expect(rustCode).toContain("#[serde(rename = \"paid\")]");
    expect(rustCode).toContain("Paid,");

    // Field mappings
    expect(rustCode).toContain("pub number: String,");
    expect(rustCode).toContain("pub customer: Customer,");
    expect(rustCode).toContain("pub status: Option<InvoiceStatus>,");
    expect(rustCode).toContain("pub lines: Option<Vec<Line>>,");

  });

  it("handles alias 'rs'", () => {
    const rustCode = generateCode(kir, "rs");
    expect(rustCode).toContain("pub struct Invoice {");
  });

  it("sanitizes Rust keywords in field names", () => {
    const modelWithKeyword = JSON.stringify({
      kerangka: "0.1",
      app: "keyword-test",
      entities: {
        Item: {
          fields: {
            type: "string!",
            match: "bool",
            fn: "string"
          }
        }
      }
    });

    const parsedKir = compile(modelWithKeyword);
    const rustCode = RustCodegen.generate(parsedKir);

    expect(rustCode).toContain("pub r#type: String,");
    expect(rustCode).toContain("pub r#match: Option<bool>,");
    expect(rustCode).toContain("pub r#fn: Option<String>,");
  });
});
