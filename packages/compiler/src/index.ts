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
export * from "./projections/openapi.js";
export * from "./projections/graphql.js";
export * from "./projections/mcp.js";
export * from "./projections/uidl.js";
export * from "./codegen/index.js";
export * from "./diff/differ.js";
export * from "./infra/compose.js";
export * from "./workspace.js";
export * from "./lint/linter.js";
export * from "./verify/verifier.js";
export * from "./packages/index.js";

import { Compiler } from "./compiler.js";
import { DDLGenerator, DDLOptions } from "./ddl/generator.js";
import { OpenAPIGenerator, OpenAPIOptions } from "./projections/openapi.js";
import { GraphQLGenerator } from "./projections/graphql.js";
import { McpGenerator, McpToolDefinition } from "./projections/mcp.js";
import { UIDLGenerator, UIDLDocument } from "./projections/uidl.js";
import { CodeGenerator, TargetLanguage, CodegenOptions } from "./codegen/index.js";
import { ModelDiffer, ModelDiffResult } from "./diff/differ.js";
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

/**
 * Generates an OpenAPI 3.1 schema specification object from a compiled KIR document.
 */
export function generateOpenAPI(kir: KIRDocument, options?: OpenAPIOptions): Record<string, unknown> {
  return OpenAPIGenerator.generate(kir, options);
}

/**
 * Generates a GraphQL Schema Definition Language (SDL) string from a compiled KIR document.
 */
export function generateGraphQL(kir: KIRDocument): string {
  return GraphQLGenerator.generate(kir);
}

/**
 * Generates Model Context Protocol (MCP) tool declarations from a compiled KIR document.
 */
export function generateMcpTools(kir: KIRDocument): McpToolDefinition[] {
  return McpGenerator.generate(kir);
}

/**
 * Generates canonical UIDL documents from views and entities in a compiled KIR document.
 */
export function generateUIDL(kir: KIRDocument): Record<string, UIDLDocument> {
  return UIDLGenerator.generate(kir);
}

/**
 * Generates target language model definitions (TypeScript, Java 21, Python, Go) from a compiled KIR document.
 */
export function generateCode(kir: KIRDocument, target: TargetLanguage, options?: CodegenOptions): string {
  return CodeGenerator.generate(kir, target, options);
}

/**
 * Analyzes differences between two model versions and classifies breaking vs additive changes.
 */
export function diffModels(oldKir: KIRDocument, newKir: KIRDocument): ModelDiffResult {
  return ModelDiffer.diff(oldKir, newKir);
}


