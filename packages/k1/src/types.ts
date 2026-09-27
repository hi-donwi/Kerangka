/**
 * Kerangka K1 Expression Types
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

export type TokenType =
  | "NUMBER"
  | "STRING"
  | "BOOLEAN"
  | "NULL"
  | "IDENTIFIER"
  | "OPERATOR"
  | "PUNCTUATION"
  | "EOF";

export interface SourceLocation {
  line: number;
  column: number;
  offset: number;
}

export interface Token {
  type: TokenType;
  value: string;
  literalValue?: unknown;
  start: SourceLocation;
  end: SourceLocation;
}

export interface LiteralNode {
  literal: string | number | boolean | null;
}

export interface BindNode {
  $bind: string;
}

export interface CallNode {
  $expr: string;
  args: ExprNode[];
}

export type ExprNode = LiteralNode | BindNode | CallNode;

export class K1SyntaxError extends Error {
  readonly code: string;
  readonly location?: SourceLocation;

  constructor(message: string, code: string, location?: SourceLocation) {
    const locStr = location ? ` at line ${location.line}, column ${location.column}` : "";
    super(`${message}${locStr}`);
    this.name = "K1SyntaxError";
    this.code = code;
    this.location = location;
  }
}

export class K1EvaluationError extends Error {
  readonly code: string;

  constructor(message: string, code: string = "EVALUATION_ERROR") {
    super(message);
    this.name = "K1EvaluationError";
    this.code = code;
  }
}

export interface EvalContext {
  state?: Record<string, unknown>;
  record?: Record<string, unknown>;
  data?: Record<string, unknown>;
  user?: Record<string, unknown>;
  now?: string | Date;
  [key: string]: unknown;
}
