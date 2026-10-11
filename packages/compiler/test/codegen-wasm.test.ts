import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { compile, generateCode, WasmCodegen } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const invoicingPath = path.resolve(__dirname, "../../../examples/invoicing.kerangka.json");
const invoicingSource = fs.readFileSync(invoicingPath, "utf-8");

describe("WebAssembly (Wasm) Code Generation", () => {
  const kir = compile(invoicingSource);

  it("generates valid Wasm Rust structs with wasm-bindgen and serde-wasm-bindgen", () => {
    const wasmCode = generateCode(kir, "wasm");

    // Imports
    expect(wasmCode).toContain("use wasm_bindgen::prelude::*;");
    expect(wasmCode).toContain("use serde::{Deserialize, Serialize};");

    // Structs with wasm_bindgen attributes
    expect(wasmCode).toContain("#[wasm_bindgen]");
    expect(wasmCode).toContain("#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]");
    expect(wasmCode).toContain("pub struct Invoice {");

    // wasm-bindgen methods for JS interoperability
    expect(wasmCode).toContain("#[wasm_bindgen(js_name = fromJson)]");
    expect(wasmCode).toContain("pub fn from_json(val: JsValue) -> Result<Invoice, JsValue>");
    expect(wasmCode).toContain("#[wasm_bindgen(js_name = toJson)]");
    expect(wasmCode).toContain("pub fn to_json(&self) -> Result<JsValue, JsValue>");
    expect(wasmCode).toContain("#[wasm_bindgen(js_name = validate)]");
    expect(wasmCode).toContain("pub fn validate(&self) -> bool");

    // Action methods
    expect(wasmCode).toContain("#[wasm_bindgen(js_name = send)]");
    expect(wasmCode).toContain("pub fn send(&mut self) -> Result<bool, JsValue>");
  });

  it("supports WasmCodegen.generate directly", () => {
    const wasmCode = WasmCodegen.generate(kir);
    expect(wasmCode).toContain("wasm32-unknown-unknown");
    expect(wasmCode).toContain("pub struct Customer");
  });
});
