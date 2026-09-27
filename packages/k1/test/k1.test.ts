import { describe, expect, it } from "vitest";
import {
  compileExpression,
  evalExpression,
  evaluate,
  K1SyntaxError,
  Parser,
} from "../src/index.js";

describe("K1 Expression Lexer & Parser", () => {
  it("parses numeric literals and basic arithmetic precedence", () => {
    const ast = compileExpression("1 + 2 * 3");
    expect(ast).toEqual({
      $expr: "+",
      args: [
        { literal: 1 },
        {
          $expr: "*",
          args: [{ literal: 2 }, { literal: 3 }],
        },
      ],
    });
    expect(evaluate(ast)).toBe(7);
  });

  it("parses grouped expressions correctly", () => {
    const ast = compileExpression("(1 + 2) * 3");
    expect(ast).toEqual({
      $expr: "*",
      args: [
        {
          $expr: "+",
          args: [{ literal: 1 }, { literal: 2 }],
        },
        { literal: 3 },
      ],
    });
    expect(evaluate(ast)).toBe(9);
  });

  it("parses the canonical invoicing formula from spec", () => {
    // "sum(lines, 'amount') * (1 - discountRate)"
    const ast = compileExpression("sum(lines, 'amount') * (1 - discountRate)");
    expect(ast).toEqual({
      $expr: "*",
      args: [
        {
          $expr: "sum",
          args: [{ $bind: "lines" }, { literal: "amount" }],
        },
        {
          $expr: "-",
          args: [{ literal: 1 }, { $bind: "discountRate" }],
        },
      ],
    });

    const context = {
      record: {
        discountRate: 0.1,
        lines: [
          { amount: 100 },
          { amount: 200 },
          { amount: 50 },
        ],
      },
    };

    const result = evaluate(ast, context);
    // 350 * 0.9 = 315
    expect(result).toBe(315);
  });

  it("parses paths and indexers", () => {
    const ast1 = compileExpression("user.profile.name");
    expect(ast1).toEqual({ $bind: "user.profile.name" });

    const ast2 = compileExpression("items[0].price");
    expect(ast2).toEqual({ $bind: "items[0].price" });

    const ctx = {
      user: { profile: { name: "Alice" } },
      items: [{ price: 42 }],
    };
    expect(evaluate(ast1, ctx)).toBe("Alice");
    expect(evaluate(ast2, ctx)).toBe(42);
  });

  it("handles unary negation and not", () => {
    expect(evalExpression("-5 + 10")).toBe(5);
    expect(evalExpression("-(5 + 10)")).toBe(-15);
    expect(evalExpression("!true")).toBe(false);
    expect(evalExpression("!false")).toBe(true);
  });

  it("evaluates relational and equality operators", () => {
    expect(evalExpression("10 > 5")).toBe(true);
    expect(evalExpression("10 >= 10")).toBe(true);
    expect(evalExpression("5 < 3")).toBe(false);
    expect(evalExpression("5 <= 5")).toBe(true);
    expect(evalExpression("42 == 42")).toBe(true);
    expect(evalExpression("42 != 43")).toBe(true);
    expect(evalExpression("'abc' == 'abc'")).toBe(true);
    expect(evalExpression("'abc' != 'def'")).toBe(true);
  });

  it("evaluates logical AND / OR with short-circuiting", () => {
    expect(evalExpression("true && false")).toBe(false);
    expect(evalExpression("true || false")).toBe(true);
    expect(evalExpression("false || 42")).toBe(42);
    expect(evalExpression("true && 'ok'")).toBe("ok");
  });

  it("respects exact decimal math rules (ADR-0004)", () => {
    // Binary float issue: 0.1 + 0.2 === 0.30000000000000004
    expect(evalExpression("0.1 + 0.2")).toBe(0.3);
    expect(evalExpression("1.0 - 0.9")).toBe(0.1);
  });

  it("strictly implements null propagation and three-valued logic", () => {
    // Arithmetic with null evaluates to null
    expect(evalExpression("10 + null")).toBeNull();
    expect(evalExpression("null * 5")).toBeNull();
    expect(evalExpression("-null")).toBeNull();

    // Comparisons against null evaluate to false
    expect(evalExpression("10 > null")).toBe(false);
    expect(evalExpression("null < 5")).toBe(false);

    // Equality: null == null is true
    expect(evalExpression("null == null")).toBe(true);
    expect(evalExpression("10 == null")).toBe(false);
    expect(evalExpression("10 != null")).toBe(true);
  });

  it("evaluates built-in string and math functions", () => {
    expect(evalExpression("abs(-42)")).toBe(42);
    expect(evalExpression("round(3.14159, 2)")).toBe(3.14);
    expect(evalExpression("min(10, 20)")).toBe(10);
    expect(evalExpression("max(10, 20)")).toBe(20);
    expect(evalExpression("lower('HELLO')")).toBe("hello");
    expect(evalExpression("upper('world')")).toBe("WORLD");
    expect(evalExpression("trim('  hello  ')")).toBe("hello");
    expect(evalExpression("concat('foo', 'bar', 'baz')")).toBe("foobarbaz");
    expect(evalExpression("len('hello')")).toBe(5);
    expect(evalExpression("contains('kerangka', 'rang')")).toBe(true);
    expect(evalExpression("coalesce(null, null, 'first')")).toBe("first");
  });

  it("enforces maximum tree depth limit (64)", () => {
    // Generate a deeply nested expression with depth > 64
    let deep = "1";
    for (let i = 0; i < 70; i++) {
      deep = `(${deep} + 1)`;
    }
    expect(() => compileExpression(deep)).toThrowError(K1SyntaxError);
  });

  it("enforces complexity limit of 100 AST nodes", () => {
    const complex = Array(110).fill("1").join(" + ");
    expect(() => compileExpression(complex)).toThrowError(K1SyntaxError);
  });
});
