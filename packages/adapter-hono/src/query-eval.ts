/**
 * Kerangka KIR Query Evaluation
 * Turns a QueryPlan (predicate AST + sort + paging) into a store filter and
 * executes it against a StorePort (PLAN.md §8.4 named queries, §10.2).
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import { QueryPlan } from "@kerangka/engine-ts";
import { QueryFilter } from "@kerangka/ports";

type ExprNode = unknown;

/** Extracts `==` equality constraints from a predicate AST (recursively for `and`). */
export function equalityConstraints(where: ExprNode | undefined): QueryFilter {
  const filter: QueryFilter = {};
  if (!Array.isArray(where)) return filter;

  const [op, left, right] = where as [string, ExprNode, ExprNode];

  if (op === "and") {
    for (const branch of (where as unknown as ExprNode[]).slice(1)) {
      Object.assign(filter, equalityConstraints(branch));
    }
    return filter;
  }

  if (op === "==" && Array.isArray(left) && left[0] === "get" && typeof left[1] === "string") {
    filter[left[1]] = right;
  }

  return filter;
}

/**
 * Evaluates a query plan in-process: equality constraints push down to the store,
 * comparison predicates (`>`, `>=`, `<`, `<=`, `!=`, `in`) filter in memory, then
 * `select`, `orderBy`, and paging apply. Soft-deleted and out-of-tenant rows are
 * excluded by the store, since the plan's `where` already carries the readFilter.
 */
export function evaluateWhereInMemory(
  records: Record<string, unknown>[],
  where: ExprNode | undefined
): Record<string, unknown>[] {
  if (!where) return records;
  return records.filter((record) => matchesExpr(record, where));
}

function matchesExpr(record: Record<string, unknown>, expr: ExprNode): boolean {
  if (!Array.isArray(expr)) return Boolean(expr);

  const [op, left, right] = expr as [string, ExprNode, ExprNode];

  switch (op) {
    case "and":
      return (expr as unknown as ExprNode[]).slice(1).every((branch) => matchesExpr(record, branch));
    case "or":
      return (expr as unknown as ExprNode[]).slice(1).some((branch) => matchesExpr(record, branch));
    case "not":
      return !matchesExpr(record, left);
    case "get":
      return Boolean(record[String(left)]);
    case "==":
      return valueOf(record, left) === valueOf(record, right);
    case "!=":
    case "<>":
      return valueOf(record, left) !== valueOf(record, right);
    case ">":
      return compare(valueOf(record, left), valueOf(record, right)) > 0;
    case ">=":
      return compare(valueOf(record, left), valueOf(record, right)) >= 0;
    case "<":
      return compare(valueOf(record, left), valueOf(record, right)) < 0;
    case "<=":
      return compare(valueOf(record, left), valueOf(record, right)) <= 0;
    case "in":
      return Array.isArray(valueOf(record, right))
        ? (valueOf(record, right) as unknown[]).includes(valueOf(record, left))
        : false;
    case "is_null":
      return valueOf(record, left) === null || valueOf(record, left) === undefined;
    default:
      // Unknown operators must not widen the result set (readFilter safety).
      throw new Error(`Query predicate operator '${op}' is not supported by the REST query evaluator`);
  }
}

function valueOf(record: Record<string, unknown>, node: ExprNode): unknown {
  if (Array.isArray(node) && node[0] === "get") return record[String(node[1])];
  if (Array.isArray(node)) {
    // Nested expressions evaluate against the record too.
    return matchesExpr(record, node) ? record : undefined;
  }
  return node;
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = String(a ?? "");
  const sb = String(b ?? "");
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** Applies plan.orderBy (multi-key) to in-memory records. */
export function applyOrderBy(
  records: Record<string, unknown>[],
  orderBy: QueryPlan["orderBy"] | undefined
): Record<string, unknown>[] {
  if (!orderBy || orderBy.length === 0) return records;
  return records.slice().sort((a, b) => {
    for (const { field, direction } of orderBy) {
      const av = a[field];
      const bv = b[field];
      if (av === bv) continue;
      const cmp = compare(av, bv);
      return direction === "desc" ? -cmp : cmp;
    }
    return 0;
  });
}

/** Applies plan.select projection. */
export function applySelect(
  records: Record<string, unknown>[],
  select: string[] | undefined
): Record<string, unknown>[] {
  if (!select || select.length === 0) return records;
  return records.map((record) => {
    const projected: Record<string, unknown> = {};
    for (const field of select) {
      if (field in record) projected[field] = record[field];
    }
    return projected;
  });
}
