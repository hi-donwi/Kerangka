import { describe, expect, it } from "vitest";
import { lowerReadFilter, ReadFilterLoweringError } from "../src/read-filter.js";

/**
 * The lowering is the only bridge between k1's `{$expr, args}` AST and the engine's tuples, and
 * the one thing it must never do is guess. A `$bind` names either the caller or the record, and
 * reading an `actor.` path as a record field produces a predicate that matches nothing — which
 * leaks nothing, and therefore looks correct to a reader who is checking for leaks.
 *
 * So these tests are mostly about what it refuses.
 */
describe("lowering a readFilter into the engine's tuples", () => {
  it("turns a comparison into a tuple over a record field and a literal", () => {
    expect(lowerReadFilter("tenantId == 'acme'")).toEqual([
      "==",
      ["get", "tenantId"],
      ["literal", "acme"]
    ]);
  });

  it("turns a caller path into an actor node, not a record read", () => {
    // The whole point. `["get", "actor.tenantId"]` would be undefined on every row.
    expect(lowerReadFilter("tenantId == actor.tenantId")).toEqual([
      "==",
      ["get", "tenantId"],
      ["actor", "tenantId"]
    ]);
  });

  it("keeps a nested actor path in one piece", () => {
    expect(lowerReadFilter("owner == actor.profile.id")).toEqual([
      "==",
      ["get", "owner"],
      ["actor", "profile.id"]
    ]);
  });

  it("keeps a nested record path as a multi-segment field", () => {
    expect(lowerReadFilter("a.b.c == 1")).toEqual(["==", ["get", "a", "b", "c"], ["literal", 1]]);
  });

  it("flattens conjunction into one `and` rather than nesting binaries", () => {
    expect(lowerReadFilter("a == 1 && b == 2 && c == 3")).toEqual([
      "and",
      ["==", ["get", "a"], ["literal", 1]],
      ["==", ["get", "b"], ["literal", 2]],
      ["==", ["get", "c"], ["literal", 3]]
    ]);
  });

  it("flattens disjunction into one `or`", () => {
    expect(lowerReadFilter("a == 1 || a == 2")).toEqual([
      "or",
      ["==", ["get", "a"], ["literal", 1]],
      ["==", ["get", "a"], ["literal", 2]]
    ]);
  });

  it("nests an `and` inside an `or` as its own node", () => {
    expect(lowerReadFilter("a == 1 || (b == 2 && c == 3)")).toEqual([
      "or",
      ["==", ["get", "a"], ["literal", 1]],
      ["and", ["==", ["get", "b"], ["literal", 2]], ["==", ["get", "c"], ["literal", 3]]]
    ]);
  });

  it("keeps a nullary call as a tuple with no operands", () => {
    expect(lowerReadFilter("createdAt < now()")).toEqual([
      "<",
      ["get", "createdAt"],
      ["now"]
    ]);
  });

  it("preserves the operators the engine already knows", () => {
    for (const op of ["==", "!=", "<", "<=", ">", ">="]) {
      const lowered = lowerReadFilter(`qty ${op} 5`) as unknown[];
      expect(lowered[0], op).toBe(op);
    }
  });

  it("cannot express `in`, because the parser has no such operator", () => {
    // The engine's evaluator does support `in`, so this looks like an oversight — it is one, and
    // it is recorded as a follow-up rather than worked around here. The important part today is
    // that an author gets a build error naming their filter, instead of a filter that quietly
    // compares `status` against the literal text "in".
    expect(() => lowerReadFilter("status in ['open', 'held']")).toThrow(ReadFilterLoweringError);
  });
});

describe("a readFilter it cannot lower is rejected, not guessed at", () => {
  it("rejects `user`, which is neither the record nor the caller", () => {
    expect(() => lowerReadFilter("email == user.email")).toThrow(ReadFilterLoweringError);
  });

  it("rejects `state` and `data` for the same reason", () => {
    expect(() => lowerReadFilter("x == state.x")).toThrow(ReadFilterLoweringError);
    expect(() => lowerReadFilter("x == data.x")).toThrow(ReadFilterLoweringError);
  });

  it("rejects a bare `actor`, which is a scope and not a value", () => {
    expect(() => lowerReadFilter("x == actor")).toThrow(/not a value/);
  });

  it("reports the author's own source, so the diagnostic points at what they wrote", () => {
    expect(() => lowerReadFilter("email == user.email")).toThrow(/email == user\.email/);
  });

  it("rejects a filter that does not parse", () => {
    expect(() => lowerReadFilter("tenantId ==")).toThrow(ReadFilterLoweringError);
  });

  it("rejects an unknown bind root rather than reading it off the record", () => {
    // A field really can be called `user`. Silently treating this as a record read is how a
    // scoping bug becomes permanent, so the author has to be explicit.
    expect(() => lowerReadFilter("x == user")).toThrow(ReadFilterLoweringError);
  });
});
