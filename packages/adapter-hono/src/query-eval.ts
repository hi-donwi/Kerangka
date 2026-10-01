/**
 * Kerangka KIR Query Evaluation
 * Turns a QueryPlan (predicate AST + sort + paging) into a store filter and
 * executes it against a StorePort (PLAN.md §8.4 named queries, §10.2).
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import { QueryPlan, ActorContext } from "@kerangka/engine-ts";
import { QueryFilter } from "@kerangka/ports";

type ExprNode = unknown;

/**
 * A query predicate the evaluator cannot honour.
 *
 * Distinct from every other error on purpose. The named-query handler wraps its whole body in
 * one `catch`, and an untyped `Error` there is indistinguishable from an internal fault: a
 * dangling import was reported to the client as `422 QUERY_INVALID` while a test named it
 * "expected 422 to be 200". Naming the one failure that genuinely is the caller's fault is what
 * lets the handler answer the rest with a 500.
 *
 * It is still thrown, still fails closed, and still never widens a result set. Typing it changes
 * which status is reported, not whether the query is answered.
 */
export class QueryEvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryEvaluationError";
  }
}

function resolvePath(obj: unknown, path: string | string[]): unknown {
  if (obj === null || obj === undefined) return undefined;
  const segments = Array.isArray(path) ? path : path.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = obj;
  for (const seg of segments) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = current[seg];
  }
  return current;
}

/** Extracts `==` equality constraints from a predicate AST (recursively for `and`). */
export function equalityConstraints(where: ExprNode | undefined, actor?: ActorContext): QueryFilter {
  const filter: QueryFilter = {};
  if (!Array.isArray(where)) return filter;

  const [op, left, right] = where as [string, ExprNode, ExprNode];

  if (op === "and") {
    for (const branch of (where as unknown as ExprNode[]).slice(1)) {
      Object.assign(filter, equalityConstraints(branch, actor));
    }
    return filter;
  }

  if (op === "==") {
    if (Array.isArray(left) && left[0] === "get" && typeof left[1] === "string" && left.length === 2) {
      if (left[1] === "deleted") {
        return filter;
      }
      const val = valueOf({}, right, actor);
      if (val !== undefined && (!Array.isArray(val) || val[0] !== "get")) {
        filter[left[1]] = val;
      }
    } else if (Array.isArray(right) && right[0] === "get" && typeof right[1] === "string" && right.length === 2) {
      if (right[1] === "deleted") {
        return filter;
      }
      const val = valueOf({}, left, actor);
      if (val !== undefined && (!Array.isArray(val) || val[0] !== "get")) {
        filter[right[1]] = val;
      }
    }
  }

  return filter;
}

/**
 * Rejects a predicate the evaluator cannot honour, before any row is examined.
 *
 * The `default` branch of `matchesExpr` throws for an unknown operator, and that was the whole of
 * the fail-closed behaviour (ADR-0008). It was not enough, because `matchesExpr` runs inside
 * `Array.prototype.filter`: on an empty candidate set the callback is never invoked, so the
 * unknown operator was never reached and the query answered `200` with an empty list. Probed, not
 * assumed — a `where` of `["nonsense", ["get", "weight"], 1]` answers 200 against an empty table
 * and 422 against a table holding one row.
 *
 * So whether a model the adapter claims to serve is actually evaluated depended on how much data
 * happened to be in the database. The operator is now checked where the predicate is, and the
 * per-row throw stays as the backstop for anything reached dynamically.
 */
export function validatePredicate(where: ExprNode | undefined, seen = new Set<string>()): void {
  if (!Array.isArray(where)) return;

  const [op, ...operands] = where as [string, ...ExprNode[]];

  switch (op) {
    case "and":
    case "or":
      operands.forEach((branch) => validatePredicate(branch, seen));
      return;
    case "not":
      validatePredicate(operands[0], seen);
      return;
    case "==":
    case "!=":
    case "<>":
    case "<":
    case "<=":
    case ">":
    case ">=":
    case "in":
    case "is_null":
      // Binary: either side may itself be a nested expression.
      operands.forEach((operand) => validatePredicate(operand, seen));
      return;
    case "get":
    case "count":
    case "now":
    case "len":
    case "literal":
    case "actor":
      return; // leaves, or operators carrying no nested predicate
    default:
      if (seen.has(op)) return; // one report per operator, not one per occurrence
      seen.add(op);
      throw new QueryEvaluationError(
        `Query predicate operator '${op}' is not supported by the REST query evaluator`
      );
  }
}

/**
 * Evaluates a query plan in-process: equality constraints push down to the store,
 * comparison predicates (`>`, `>=`, `<`, `<=`, `!=`, `in`) filter in memory, then
 * `select`, `orderBy`, and paging apply. Soft-deleted and out-of-tenant rows are
 * excluded by the store, since the plan's `where` already carries the readFilter.
 */
export function evaluateWhereInMemory(
  records: Record<string, unknown>[],
  where: ExprNode | undefined,
  actor?: ActorContext
): Record<string, unknown>[] {
  if (!where) return records;
  // Checked here, not left to the per-row switch: an empty `records` would skip the callback
  // entirely and an unsupported operator would go unreported. See `validatePredicate`.
  validatePredicate(where);
  return records.filter((record) => matchesExpr(record, where, actor));
}

function matchesExpr(
  record: Record<string, unknown>,
  expr: ExprNode,
  actor?: ActorContext
): boolean {
  if (!Array.isArray(expr)) return Boolean(expr);

  const [op, left, right] = expr as [string, ExprNode, ExprNode];

  switch (op) {
    case "and":
      return (expr as unknown as ExprNode[]).slice(1).every((branch) => matchesExpr(record, branch, actor));
    case "or":
      return (expr as unknown as ExprNode[]).slice(1).some((branch) => matchesExpr(record, branch, actor));
    case "not":
      return !matchesExpr(record, left, actor);
    case "get":
      return Boolean(valueOf(record, expr, actor));
    case "==": {
      const l = valueOf(record, left, actor);
      const r = valueOf(record, right, actor);
      if (r === false && (l === false || l === undefined || l === null)) return true;
      if (l === false && (r === false || r === undefined || r === null)) return true;
      return l === r;
    }
    case "!=":
    case "<>":
      return valueOf(record, left, actor) !== valueOf(record, right, actor);
    case ">":
      return compare(valueOf(record, left, actor), valueOf(record, right, actor)) > 0;
    case ">=":
      return compare(valueOf(record, left, actor), valueOf(record, right, actor)) >= 0;
    case "<":
      return compare(valueOf(record, left, actor), valueOf(record, right, actor)) < 0;
    case "<=":
      return compare(valueOf(record, left, actor), valueOf(record, right, actor)) <= 0;
    case "in":
      return Array.isArray(valueOf(record, right, actor))
        ? (valueOf(record, right, actor) as unknown[]).includes(valueOf(record, left, actor))
        : false;
    case "is_null":
      return valueOf(record, left, actor) === null || valueOf(record, left, actor) === undefined;
    default:
      // Unknown operators must not widen the result set (readFilter safety).
      throw new QueryEvaluationError(
        `Query predicate operator '${op}' is not supported by the REST query evaluator`
      );
  }
}

function valueOf(
  record: Record<string, unknown>,
  node: ExprNode,
  actor?: ActorContext
): unknown {
  if (!Array.isArray(node)) return node;

  const tag = node[0];
  if (tag === "get") {
    const segments = node.slice(1);
    if (segments.length === 1) return record[String(segments[0])];
    return resolvePath(record, segments as string[]);
  }
  if (tag === "literal") {
    return node[1];
  }
  if (tag === "actor") {
    const path = String(node[1]);
    return resolvePath(actor, path);
  }
  if (tag === "now") {
    return new Date().toISOString();
  }

  // Nested expressions evaluate against the record too.
  return matchesExpr(record, node, actor) ? record : undefined;
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
