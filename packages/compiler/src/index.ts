/**
 * @kerangka/compiler
 * Compiler pipeline and IR generation for Kerangka.
 *
 * Status: Draft 0.1
 * License: Apache-2.0
 */

export * from "./types.js";
export * from "./shorthand.js";
export * from "./compiler.js";
export * from "./ddl/generator.js";

import { Compiler } from "./compiler.js";
import { DDLGenerator, DDLOptions } from "./ddl/generator.js";
import { CompilerOptions, KIRDocument, RawKerangkaDocument } from "./types.js";

/**
 * Compiles a raw Kerangka document or string into canonical Intermediate Representation (KIR).
 */
export function compile(input: string | RawKerangkaDocument, options?: CompilerOptions): KIRDocument {
  return Compiler.compile(input, options);
}

/**
 * Generates SQL DDL schema statements from a compiled KIR document.
 */
export function generateDDL(kir: KIRDocument, options?: DDLOptions): string {
  return DDLGenerator.generate(kir, options);
}
