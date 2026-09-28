/**
 * @kerangka/k1
 * K1 expression tokenizer, parser, AST node definitions, and evaluator.
 *
 * Specification: spec/k1.ebnf, spec/semantics/expressions.md
 * Status: Draft 0.1
 * License: Apache-2.0
 */

export * from "./types.js";
export * from "./lexer.js";
export * from "./parser.js";
export * from "./evaluator.js";
export * from "./builtins.js";
export * from "./temporal.js";

import { Parser } from "./parser.js";
import { evaluate } from "./evaluator.js";
import { EvalContext, ExprNode } from "./types.js";

/**
 * Convenience helper to compile an infix K1 expression string into a canonical AST.
 */
export function compileExpression(source: string): ExprNode {
  return Parser.parse(source);
}

/**
 * Convenience helper to parse and evaluate an infix K1 expression string in one call.
 */
export function evalExpression(source: string, ctx: EvalContext = {}): unknown {
  const ast = Parser.parse(source);
  return evaluate(ast, ctx);
}
