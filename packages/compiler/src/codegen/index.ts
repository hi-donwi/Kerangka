/**
 * Kerangka Multi-Language Code Generator
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import { KIRDocument } from "../types.js";
import { TypeScriptCodegen } from "./ts.js";
import { JavaCodegen } from "./java.js";
import { PythonCodegen } from "./python.js";
import { GoCodegen } from "./go.js";
import { RustCodegen } from "./rust.js";
import { DartCodegen } from "./dart.js";

export type TargetLanguage = "ts" | "typescript" | "java" | "python" | "py" | "go" | "golang" | "rust" | "rs" | "dart";

export interface CodegenOptions {
  packageName?: string;
}

export class CodeGenerator {
  static generate(kir: KIRDocument, target: TargetLanguage, options: CodegenOptions = {}): string {
    const norm = target.toLowerCase();
    switch (norm) {
      case "ts":
      case "typescript":
        return TypeScriptCodegen.generate(kir);
      case "java":
        return JavaCodegen.generate(kir, options.packageName || "com.kerangka.model");
      case "py":
      case "python":
        return PythonCodegen.generate(kir);
      case "go":
      case "golang":
        return GoCodegen.generate(kir, options.packageName || "model");
      case "rust":
      case "rs":
        return RustCodegen.generate(kir);
      case "dart":
        return DartCodegen.generate(kir);
      default:
        throw new Error(`Unsupported codegen target language: '${target}'. Supported targets: ts, java, python, go, rust, dart`);
    }
  }
}

export { TypeScriptCodegen, JavaCodegen, PythonCodegen, GoCodegen, RustCodegen, DartCodegen };


