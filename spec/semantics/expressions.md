# Kerangka Semantics: Expressions and Evaluation

- **Specification Version:** 0.1
- **Status:** Draft

## 1. Syntax and Abstract Syntax Tree (AST)

Kerangka expressions are authored as infix strings in `*.kerangka.json` or `*.kerangka.yaml`:
```json
"total": "sum(lines, 'amount') * (1 - discountRate)"
```

The compiler parses infix strings into canonical UIDL expression AST nodes (`literal`, `$bind`, `$expr`):
```json
{
  "$expr": "*",
  "args": [
    { "$expr": "sum", "args": [{ "$bind": "lines" }, { "literal": "amount" }] },
    { "$expr": "-", "args": [{ "literal": 1 }, { "$bind": "discountRate" }] }
  ]
}
```

## 2. Bounded Evaluation Guarantees

Expressions evaluate under strict non-Turing-complete safety constraints:
1. **No Loops or Recursion:** Expressions only perform tree reductions and bounded aggregate reductions over in-memory collections.
2. **Depth Limit:** Maximum expression tree depth is **64**. Trees exceeding this depth fail compilation with `EXPRESSION_TOO_DEEP`.
3. **Complexity Limit:** A single expression must not exceed 100 AST nodes (recommended lint limit is 30).
4. **Termination:** Every valid expression is mathematically guaranteed to terminate in finite steps.

## 3. Null Handling and Three-Valued Logic

- **Arithmetic Propagation:** Any arithmetic operation (`+`, `-`, `*`, `/`, `%`) involving a `null` operand evaluates to `null`.
- **String Concatenation:** `concat('Hello ', null)` evaluates to `null`. Use `coalesce(val, '')` to substitute empty strings.
- **Relational Comparisons:** `<` , `<=`, `>`, `>=` against `null` evaluate to `false`.
- **Equality:** `null == null` evaluates to `true`; `x == null` evaluates to `false` if `x` is non-null.
- **Fail-Closed Conditionals:** In guards and permission conditions, an expression evaluating to `null` is treated as `false` (`GUARD_FAILED`).
