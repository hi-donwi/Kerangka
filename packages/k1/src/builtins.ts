/**
 * Kerangka K1 Built-in Names
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 *
 * The single list of names the evaluator implements. The compiler uses it to reject
 * calls the engines cannot run; the K1 tests keep it in step with the evaluator.
 */

/** Functions callable by name, e.g. `round(total, 2)`. */
export const K1_FUNCTIONS: readonly string[] = [
  "abs",
  "avg",
  "ceil",
  "coalesce",
  "concat",
  "contains",
  "count",
  "floor",
  "isSet",
  "isUnchanged",
  "len",
  "lower",
  "max",
  "min",
  "now",
  "round",
  "sum",
  "trim",
  "upper",
];

/** Operator names the parser emits for infix and prefix operators. */
export const K1_OPERATORS: readonly string[] = [
  "!", "!=", "%", "&&", "*", "+", "-", "/", "<", "<=", "==", ">", ">=", "||",
  "and", "eq", "neg", "neq", "not", "or",
];

/**
 * Aggregates whose second argument is evaluated once per row of the list named by the
 * first, e.g. `sum(lines, qty * unitPrice)`. Inside that argument bare names refer to the
 * row and `record.<field>` to the outer record (PLAN.md section 5.5).
 */
export const K1_ROW_AGGREGATES: readonly string[] = ["sum", "avg"];
