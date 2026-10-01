import { compileExpression } from "@kerangka/k1";
import type { ExprNode as K1Node } from "@kerangka/k1";

/**
 * Lowers a K1 expression into the engine's tuple AST.
 *
 * There are two ASTs in this codebase and this is the only place they meet. `@kerangka/k1` parses
 * the author's infix source into `{$expr, args}` / `{$bind}` / `{literal}`; the engine, the REST
 * query evaluator, and `ports.QueryPredicate` all speak tuples `["op", left, right]`. Until now
 * nothing bridged them, so a `readFilter` stayed a string from the compiler all the way to the
 * engine, where `engine.ts:1456` only accepted an object and so dropped it. A model that declared
 * a read filter ran with none, and reported nothing.
 *
 * The interesting part is `$bind`. A bind is a dotted path, and which thing it names depends on
 * its first segment:
 *
 * - `actor.tenantId` is a path into the **caller**, and becomes `["actor", "tenantId"]`.
 * - anything else is a field of the **record**, and becomes `["get", "field"]`.
 *
 * Those two are not interchangeable, and conflating them is the failure this function exists to
 * prevent: lowered as a record read, `["get", "actor.tenantId"]` is `undefined` on every row, so
 * the predicate matches nothing. A filter that matches nothing leaks nothing, which is how a
 * serious bug survives a security review looking correct.
 *
 * A path into anything other than the record or the actor — `user.x`, `state.y`, `data.z` — is
 * rejected rather than guessed at. It would be a record read by default, and a record field
 * called `user` is a legitimate thing to filter on, so the honest answer is to require the author
 * to say which they meant. See ADR-0040.
 */

/** The tuple form the engine evaluates. Kept structural; `ports` may not depend on the engine. */
export type TupleExpr = unknown;

export class ReadFilterLoweringError extends Error {
  readonly code = "READ_FILTER_LOWERING_FAILED";

  constructor(
    message: string,
    /** The author's source, so the diagnostic points at something they wrote. */
    readonly source: string
  ) {
    super(`${message} in readFilter: ${source}`);
    this.name = "ReadFilterLoweringError";
  }
}

/** Bind roots that name the caller. Everything else must be an explicit record field. */
const ACTOR_ROOT = "actor";

/** Bind roots that mean something else entirely, and so cannot be lowered to a record read. */
const FOREIGN_ROOTS = new Set(["user", "state", "data", "functions", "now", "record"]);

/** Operators k1 emits with no arguments. They lower to themselves. */
const NULLARY: ReadonlySet<string> = new Set(["now", "len", "count", "uuid", "lower", "upper", "abs"]);

export function lowerReadFilter(source: string): TupleExpr {
  let ast: K1Node;
  try {
    ast = compileExpression(source);
  } catch (error) {
    throw new ReadFilterLoweringError(
      error instanceof Error ? error.message : "could not be parsed",
      source
    );
  }
  return lowerNode(ast, source);
}

function lowerNode(node: K1Node, source: string): TupleExpr {
  if (node === null || typeof node !== "object") {
    throw new ReadFilterLoweringError("produced a node that is not an expression", source);
  }

  if ("literal" in node) {
    // A bare literal. `["literal", v]` so it stays a tuple the evaluator can read, rather than a
    // naked JS value that would be indistinguishable from a field name.
    return ["literal", node.literal];
  }

  if ("$bind" in node) {
    return lowerBind(node.$bind, source);
  }

  if ("$expr" in node) {
    return lowerCall(node.$expr, node.args ?? [], source);
  }

  throw new ReadFilterLoweringError("produced an unrecognised node", source);
}

function lowerBind(path: string, source: string): TupleExpr {
  const segments = path.split(".");
  const root = segments[0];

  if (!root) {
    throw new ReadFilterLoweringError("names an empty field", source);
  }
  const rest = segments.slice(1);

  if (root === ACTOR_ROOT) {
    if (rest.length === 0) {
      throw new ReadFilterLoweringError("'actor' on its own is not a value", source);
    }
    return ["actor", rest.join(".")];
  }

  if (FOREIGN_ROOTS.has(root)) {
    throw new ReadFilterLoweringError(
      `'${root}' is not a record field or a property of the caller, so it cannot be used in a readFilter`,
      source
    );
  }

  // A record field, possibly nested: `owner.id` -> ["get", "owner", "id"].
  return ["get", ...path.split(".")];
}

function lowerCall(op: string, args: K1Node[], source: string): TupleExpr {
  // k1 spells conjunction and disjunction `&&` and `||`; the engine spells them `and` and `or`.
  // k1 also parses `a && b && c` as a binary tree, left-associative, so the arguments arrive
  // already nested: `[["and", a, b], c]`. Flattening is therefore recursive — one level of
  // splicing would leave `["and", ["and", a, b], c]`, which still evaluates correctly and is
  // still the shape nobody expects to find in a debugger.
  if (op === "&&" || op === "and") return flatten("and", args, source);
  if (op === "||" || op === "or") return flatten("or", args, source);

  const lowered = args.map((arg) => lowerNode(arg, source));

  if (lowered.length === 0) return [op];
  if (NULLARY.has(op)) return [op];
  if (lowered.length === 1) return [op, lowered[0]];

  return [op, lowered[0], lowered[1]];
}

/** `["and", a, b, c]`, with any nested `and` spliced into the same list. */
function flatten(connector: "and" | "or", args: K1Node[], source: string): TupleExpr {
  const flat: TupleExpr[] = [];
  for (const arg of args) {
    const lowered = lowerNode(arg, source);
    if (Array.isArray(lowered) && lowered[0] === connector) {
      flat.push(...(lowered.slice(1) as TupleExpr[]));
    } else {
      flat.push(lowered);
    }
  }
  return [connector, ...flat];
}
