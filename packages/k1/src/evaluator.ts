/**
 * Kerangka K1 Expression Evaluator
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import {
  CallNode,
  EvalContext,
  ExprNode,
  K1EvaluationError,
} from "./types.js";

/**
 * Exact decimal arithmetic helpers to avoid binary float artifacts (ADR-0004).
 */
export class DecimalMath {
  static round(num: number, decimals = 0): number {
    const factor = 10 ** decimals;
    return Math.round((num + Number.EPSILON) * factor) / factor;
  }

  static add(a: number, b: number): number {
    const res = a + b;
    return DecimalMath.round(res, 10);
  }

  static sub(a: number, b: number): number {
    const res = a - b;
    return DecimalMath.round(res, 10);
  }

  static mul(a: number, b: number): number {
    const res = a * b;
    return DecimalMath.round(res, 10);
  }

  static div(a: number, b: number): number {
    if (b === 0) {
      throw new K1EvaluationError("Division by zero", "DIVISION_BY_ZERO");
    }
    const res = a / b;
    return DecimalMath.round(res, 10);
  }

  static mod(a: number, b: number): number {
    if (b === 0) {
      throw new K1EvaluationError("Modulo by zero", "MODULO_BY_ZERO");
    }
    return a % b;
  }
}

/**
 * Resolves a dot/bracket path against an evaluation context.
 * E.g. "lines[0].amount" or "discountRate"
 */
export function resolvePath(path: string, ctx: EvalContext): unknown {
  // If the path is a direct key in ctx
  if (path in ctx) {
    return ctx[path];
  }

  // Check state or record if present
  if (ctx.record && typeof ctx.record === "object" && path in (ctx.record as Record<string, unknown>)) {
    return (ctx.record as Record<string, unknown>)[path];
  }

  if (ctx.state && typeof ctx.state === "object" && path in (ctx.state as Record<string, unknown>)) {
    return (ctx.state as Record<string, unknown>)[path];
  }

  if (ctx.data && typeof ctx.data === "object" && path in (ctx.data as Record<string, unknown>)) {
    return (ctx.data as Record<string, unknown>)[path];
  }

  // Tokenize path segments: e.g. "lines[0].amount" -> ["lines", 0, "amount"]
  const segments: (string | number)[] = [];
  const regex = /([a-zA-Z_][a-zA-Z0-9_]*)|\[(\d+)\]|\[['"]([^'"]+)['"]\]/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(path)) !== null) {
    if (match[1] !== undefined) {
      segments.push(match[1]);
    } else if (match[2] !== undefined) {
      segments.push(parseInt(match[2], 10));
    } else if (match[3] !== undefined) {
      segments.push(match[3]);
    }
  }

  if (segments.length === 0) {
    return null;
  }

  // Choose starting root: ctx, or ctx.record, or ctx.state
  let current: unknown = ctx;
  const firstSeg = segments[0] as string;

  if (!(firstSeg in ctx)) {
    if (ctx.record && typeof ctx.record === "object" && firstSeg in (ctx.record as Record<string, unknown>)) {
      current = ctx.record;
    } else if (ctx.state && typeof ctx.state === "object" && firstSeg in (ctx.state as Record<string, unknown>)) {
      current = ctx.state;
    } else if (ctx.data && typeof ctx.data === "object" && firstSeg in (ctx.data as Record<string, unknown>)) {
      current = ctx.data;
    }
  }

  for (const seg of segments) {
    if (current === null || current === undefined) {
      return null;
    }
    if (typeof current === "object") {
      current = (current as Record<string | number, unknown>)[seg];
    } else {
      return null;
    }
  }

  return current ?? null;
}

/**
 * Evaluates an AST expression node in an execution context.
 */
export function evaluate(node: ExprNode, ctx: EvalContext = {}): unknown {
  // 1. Literal
  if ("literal" in node) {
    return node.literal;
  }

  // 2. Bind (Path)
  if ("$bind" in node) {
    return resolvePath(node.$bind, ctx);
  }

  // 3. Expression / Function call
  if ("$expr" in node) {
    return evaluateCall(node, ctx);
  }

  throw new K1EvaluationError("Invalid expression node", "INVALID_NODE");
}

function evaluateCall(node: CallNode, ctx: EvalContext): unknown {
  const op = node.$expr;
  const args = node.args;

  // Unary operators
  if (args.length === 1) {
    if (op === "!" || op === "not") {
      const val = evaluate(args[0]!, ctx);
      return !val;
    }
    if (op === "-" || op === "neg") {
      const val = evaluate(args[0]!, ctx);
      if (val === null || val === undefined) return null;
      if (typeof val === "number") return -val;
      throw new K1EvaluationError(`Cannot apply unary negation to non-number ${typeof val}`, "TYPE_ERROR");
    }
  }

  // Binary logical operators (short-circuiting)
  if (op === "||" || op === "or") {
    const left = evaluate(args[0]!, ctx);
    if (Boolean(left)) return left;
    return evaluate(args[1]!, ctx);
  }

  if (op === "&&" || op === "and") {
    const left = evaluate(args[0]!, ctx);
    if (!Boolean(left)) return left;
    return evaluate(args[1]!, ctx);
  }

  // Conditional / Ternary (UIDL 'if')
  if (op === "if") {
    const cond = evaluate(args[0]!, ctx);
    if (Boolean(cond)) {
      return args[1] !== undefined ? evaluate(args[1], ctx) : null;
    } else {
      return args[2] !== undefined ? evaluate(args[2], ctx) : null;
    }
  }

  // Evaluate operands for arithmetic and comparisons
  const left = args[0] ? evaluate(args[0], ctx) : null;
  const right = args[1] ? evaluate(args[1], ctx) : null;

  // Equality (Three-valued logic rules from spec/semantics/expressions.md §3)
  if (op === "==" || op === "eq") {
    if (left === null && right === null) return true;
    if (left === null || right === null) return false;
    return left === right;
  }

  if (op === "!=" || op === "neq") {
    if (left === null && right === null) return false;
    if (left === null || right === null) return true;
    return left !== right;
  }

  // Null propagation in arithmetic: returns null if either operand is null
  if (["+", "-", "*", "/", "%", "add", "subtract", "multiply", "divide", "mod"].includes(op)) {
    if (left === null || right === null || left === undefined || right === undefined) {
      return null;
    }
    if (typeof left !== "number" || typeof right !== "number") {
      // String concatenation on '+' or 'add' if both are strings
      if ((op === "+" || op === "add") && typeof left === "string" && typeof right === "string") {
        return left + right;
      }
      throw new K1EvaluationError(`Arithmetic operator '${op}' expects numeric operands`, "TYPE_ERROR");
    }

    switch (op) {
      case "+":
      case "add":
        return DecimalMath.add(left, right);
      case "-":
      case "subtract":
        return DecimalMath.sub(left, right);
      case "*":
      case "multiply":
        return DecimalMath.mul(left, right);
      case "/":
      case "divide":
        return DecimalMath.div(left, right);
      case "%":
      case "mod":
        return DecimalMath.mod(left, right);
    }
  }

  // Relational comparisons: false if either is null
  if (["<", "<=", ">", ">=", "lt", "lte", "gt", "gte"].includes(op)) {
    if (left === null || right === null || left === undefined || right === undefined) {
      return false;
    }
    if (typeof left !== typeof right) {
      return false;
    }
    switch (op) {
      case "<":
      case "lt":
        return (left as number) < (right as number);
      case "<=":
      case "lte":
        return (left as number) <= (right as number);
      case ">":
      case "gt":
        return (left as number) > (right as number);
      case ">=":
      case "gte":
        return (left as number) >= (right as number);
    }
  }

  // Built-in functions
  switch (op) {
    // Mathematical
    case "abs": {
      if (left === null) return null;
      if (typeof left === "number") return Math.abs(left);
      throw new K1EvaluationError("abs() requires a number", "TYPE_ERROR");
    }
    case "round": {
      if (left === null) return null;
      if (typeof left === "number") {
        const decimals = typeof right === "number" ? right : 0;
        return DecimalMath.round(left, decimals);
      }
      throw new K1EvaluationError("round() requires a number", "TYPE_ERROR");
    }
    case "ceil": {
      if (left === null) return null;
      if (typeof left === "number") return Math.ceil(left);
      throw new K1EvaluationError("ceil() requires a number", "TYPE_ERROR");
    }
    case "floor": {
      if (left === null) return null;
      if (typeof left === "number") return Math.floor(left);
      throw new K1EvaluationError("floor() requires a number", "TYPE_ERROR");
    }
    case "min": {
      if (left === null || right === null) return null;
      if (typeof left === "number" && typeof right === "number") return Math.min(left, right);
      throw new K1EvaluationError("min() requires numeric arguments", "TYPE_ERROR");
    }
    case "max": {
      if (left === null || right === null) return null;
      if (typeof left === "number" && typeof right === "number") return Math.max(left, right);
      throw new K1EvaluationError("max() requires numeric arguments", "TYPE_ERROR");
    }

    // String
    case "lower": {
      if (left === null) return null;
      return String(left).toLowerCase();
    }
    case "upper": {
      if (left === null) return null;
      return String(left).toUpperCase();
    }
    case "trim": {
      if (left === null) return null;
      return String(left).trim();
    }
    case "len": {
      if (left === null) return 0;
      if (typeof left === "string" || Array.isArray(left)) return left.length;
      return 0;
    }
    case "contains": {
      if (left === null || right === null) return false;
      if (typeof left === "string") return left.includes(String(right));
      if (Array.isArray(left)) return left.includes(right);
      return false;
    }
    case "concat": {
      const evaluatedArgs = args.map((a) => evaluate(a, ctx));
      if (evaluatedArgs.some((a) => a === null || a === undefined)) {
        return null;
      }
      return evaluatedArgs.map(String).join("");
    }

    // Collection aggregates
    case "count": {
      if (left === null || left === undefined) return 0;
      if (Array.isArray(left)) return left.length;
      return 0;
    }
    case "sum": {
      if (!Array.isArray(left)) return 0;
      const mapperNode = args[1];
      let total = 0;
      for (const item of left) {
        let val: unknown = item;
        if (mapperNode) {
          if ("literal" in mapperNode && typeof mapperNode.literal === "string") {
            val = typeof item === "object" && item !== null ? (item as Record<string, unknown>)[mapperNode.literal] : item;
          } else {
            const itemScope = typeof item === "object" && item !== null ? { ...(item as Record<string, unknown>), record: item } : { item };
            val = evaluate(mapperNode, { ...ctx, ...itemScope });
          }
        }
        if (typeof val === "number" && !isNaN(val)) {
          total = DecimalMath.add(total, val);
        }
      }
      return total;
    }
    case "avg": {
      if (!Array.isArray(left) || left.length === 0) return 0;
      const total = evaluateCall({ $expr: "sum", args }, ctx) as number;
      return DecimalMath.div(total, left.length);
    }

    // Contextual & State
    case "isSet": {
      return left !== null && left !== undefined;
    }
    case "isUnchanged": {
      const fieldName = typeof left === "string" ? left : "";
      if (ctx.initial && typeof ctx.initial === "object") {
        const initialVal = (ctx.initial as Record<string, unknown>)[fieldName];
        const currentVal = resolvePath(fieldName, ctx);
        return initialVal === currentVal;
      }
      return true;
    }
    case "coalesce": {
      for (const arg of args) {
        const val = evaluate(arg, ctx);
        if (val !== null && val !== undefined) return val;
      }
      return null;
    }
    case "startsWith": {
      if (left === null || right === null) return false;
      return String(left).startsWith(String(right));
    }
    case "in": {
      if (left === null || right === null) return false;
      if (Array.isArray(right)) return right.includes(left);
      return false;
    }
    case "today": {
      const nowStr = ctx.now ? (typeof ctx.now === "string" ? ctx.now : ctx.now.toISOString()) : new Date().toISOString();
      return nowStr.split("T")[0];
    }
    case "now": {
      return ctx.now ? (typeof ctx.now === "string" ? ctx.now : ctx.now.toISOString()) : new Date().toISOString();
    }

    default:
      throw new K1EvaluationError(`Unknown function or operator '${op}'`, "UNKNOWN_OPERATOR");
  }
}
