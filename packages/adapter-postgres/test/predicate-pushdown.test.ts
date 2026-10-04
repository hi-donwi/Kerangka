import { describe, expect, it } from "vitest";
import { compile } from "@kerangka/compiler";
import { PostgresQueryBuilder } from "../src/index.js";

/**
 * A pushed predicate must be implied by the engine's, never stricter.
 *
 * Every test below is about which clauses reach the SQL, and most of them are about clauses that
 * must *not*. A pushdown that is too aggressive is the one failure this suite cannot see at
 * runtime: the store returns fewer rows than the model promises, the response is a well-formed
 * 200, and nothing anywhere reports the difference. So the excluded cases are asserted as
 * precisely as the accepted ones, and each exclusion is checked for the reason it exists rather
 * than for its operator.
 *
 * See ADR-0039 for the invariant and for why the type allowlist is as short as it is, and
 * ADR-0041 for the decisions that unlocked `!=` and a literal-list `in`.
 */
const kir = compile(
  JSON.stringify({
    kerangka: "0.1",
    app: "pushdown",
    entities: {
      Item: {
        fields: {
          id: "string!",
          // present and int: the one combination that is provably safe to order on
          qty: "int!",
          // present, but not an int
          price: "decimal(12,2)!",
          // int, but not required, so the column is nullable
          weight: "int",
          // required, but ordered lexicographically by the engine and by collation here
          label: "string!",
          // required, and TIMESTAMPTZ comes back as a Date
          dueOn: "datetime!"
        }
      }
    }
  })
);

const builder = () => new PostgresQueryBuilder(kir);

/** The WHERE clause of the find query, split into its conjuncts. Empty when there is none. */
const clauses = (where: unknown): string[] => {
  const { dataQuery } = builder().buildFind("Item", undefined, { where: where as never });
  const sql = dataQuery.sql.split(" WHERE ")[1];
  if (!sql) return [];
  return sql.split(" ORDER BY")[0]!.split(" AND ");
};

const get = (field: string) => ["get", field];

describe("pushing a comparison into SQL", () => {
  it("pushes an ordering on a required integer column", () => {
    const query = builder().buildFind("Item", undefined, { where: [">=", get("qty"), 10] as never });

    expect(query.dataQuery.sql).toContain("WHERE qty >= $1");
    expect(query.dataQuery.values).toEqual([10]);
  });

  it("pushes every ordering operator it claims to", () => {
    for (const operator of ["<", "<=", ">", ">="]) {
      expect(clauses([operator, get("qty"), 5]), operator).toEqual([`qty ${operator} $1`]);
    }
  });

  it("binds the value as a parameter, never as SQL text", () => {
    // The one thing that must never regress: a predicate is data, and data is not concatenated.
    const query = builder().buildFind("Item", undefined, { where: [">", get("qty"), "1; DROP TABLE item"] as never });

    expect(query.dataQuery.values).toEqual(["1; DROP TABLE item"]);
    expect(query.dataQuery.sql).not.toContain("DROP TABLE");
    expect(query.dataQuery.sql).toContain("qty > $1");
  });

  it("pushes each conjunct of an `and` chain", () => {
    const query = builder().buildFind("Item", undefined, {
      where: ["and", [">", get("qty"), 1], ["<", get("qty"), 100]] as never
    });

    expect(query.dataQuery.sql).toContain("qty > $1 AND qty < $2");
    expect(query.dataQuery.values).toEqual([1, 100]);
  });

  it("combines pushed orderings with the equality filter, numbering the parameters in order", () => {
    const query = builder().buildFind("Item", { id: "i-1" }, { where: [">", get("qty"), 3] as never });

    expect(query.dataQuery.sql).toContain("WHERE id = $1 AND qty > $2");
    expect(query.dataQuery.values).toEqual(["i-1", 3]);
  });
});

describe("a comparison it cannot prove is not pushed", () => {
  it("leaves a nullable column alone, because the engine keeps the row and SQL drops it", () => {
    // The reason `required` is checked. `compare` treats an absent value as "", so `> 100`
    // keeps a row whose `weight` is missing; `WHERE weight > 100` drops it. Pushed, the store
    // would be stricter than the model.
    expect(clauses([">", get("weight"), 100])).toEqual([]);
  });

  it("leaves a decimal column alone, because `pg` returns NUMERIC as a string", () => {
    // The engine would then compare "100.00" < "20.00" as text and get the wrong answer.
    expect(clauses([">", get("price"), 10])).toEqual([]);
  });

  it("leaves a text column alone, because collation need not match code-unit order", () => {
    expect(clauses([">", get("label"), "m"])).toEqual([]);
  });

  it("leaves a temporal column alone, because `pg` returns a Date and the engine compares its string form", () => {
    expect(clauses([">", get("dueOn"), "2026-01-01T00:00:00Z"])).toEqual([]);
  });

  it("leaves a comparison against null alone, for every operator", () => {
    // The engine answers through `compare`'s string fall-through and keeps the row: String(5)
    // against String(null ?? "") is "5" > "". SQL answers `col > NULL` with NULL and drops
    // every row. Pushed, the store would be the stricter of the two for the least defensible
    // reason there is: the value is not a value. ADR-0041 closes this for `!=` and, while
    // there, for the orderings that were already pushed.
    expect(clauses([">", get("qty"), null])).toEqual([]);
    expect(clauses(["!=", get("qty"), null])).toEqual([]);
  });

  it("leaves a disjunction alone, because neither operand is necessary", () => {
    const query = builder().buildFind("Item", undefined, {
      where: ["or", [">", get("qty"), 1], ["<", get("qty"), 100]] as never
    });

    expect(query.dataQuery.sql).not.toContain("qty");
    expect(query.dataQuery.values).toEqual([]);
  });

  it("leaves `in` alone when the right side is not a literal array", () => {
    expect(clauses(["in", get("qty"), get("weight")])).toEqual([]);
  });

  it("leaves a comparison between two fields alone, because the right side is not a value", () => {
    expect(clauses([">", get("qty"), get("weight")])).toEqual([]);
  });

  it("leaves a comparison against an expression alone", () => {
    expect(clauses([">", get("qty"), ["+", 1, 2]])).toEqual([]);
  });

  it("leaves an unknown field alone rather than inventing a column for it", () => {
    // No KIR entry means no `required` flag to check, so the guard is not satisfied. Emitting
    // `nonexistent > $1` would be a SQL error at runtime, not a wrong result — but a wrong
    // result is a worse thing to introduce than a bug that announces itself.
    expect(clauses([">", get("nonexistent"), 1])).toEqual([]);
  });

  it("leaves a nested field path alone", () => {
    expect(clauses([">", ["get", "nested", "deep"], 1])).toEqual([]);
  });
});

describe("a denied equality and a literal list push down (ADR-0041)", () => {
  it("pushes `!=` on a required integer column, because NOT NULL removes the NULL disagreement", () => {
    // Three implementations disagreed about a NULL column: kept by `item[k] !== v`, dropped by
    // `<>`, dropped by `!=`. On a required field the column is NOT NULL, so no such row can
    // exist, and the two remaining answers agree on every row the store can hold.
    expect(clauses(["!=", get("qty"), 1])).toEqual(["qty <> $1"]);
  });

  it("pushes the `<>` spelling the same way", () => {
    expect(clauses(["<>", get("qty"), 1])).toEqual(["qty <> $1"]);
  });

  it("leaves `!=` on a nullable column alone, where the disagreement still exists", () => {
    expect(clauses(["!=", get("weight"), 1])).toEqual([]);
  });

  it("leaves `!=` alone unless the value is a number, because the engine compares strictly", () => {
    // `5 !== "5"` keeps every row; `qty <> '5'` casts and drops the fives. The store would be
    // the stricter of the two. The orderings get away with a string literal because their
    // engine answer falls through to the same lexicographic compare; `!=` has no such
    // agreement, so its gate is tighter from birth.
    expect(clauses(["!=", get("qty"), "5"])).toEqual([]);
    expect(clauses(["!=", get("qty"), true])).toEqual([]);
  });

  it("pushes a literal `in` list as an expanded membership test", () => {
    // ADR-0039 refused `in` as "a disjunction". The disjunction it worried about is an `or`
    // whose operands need not hold; a membership test over one NOT NULL column of an
    // allowlisted type is one predicate that SQL and `list.includes` evaluate the same way,
    // so the pushed clause is implied, not stricter. Expanded parameters, not `= ANY($1)`,
    // because array binding is a driver courtesy and the executor is an interface.
    const query = builder().buildFind("Item", undefined, { where: ["in", get("qty"), [1, 2, 3]] as never });

    expect(query.dataQuery.sql).toContain("qty IN ($1, $2, $3)");
    expect(query.dataQuery.values).toEqual([1, 2, 3]);
  });

  it("pushes an empty `in` list as FALSE, which is the engine's answer for every row", () => {
    // `[].includes(v)` is false for every v, so the store may narrow to nothing. `IN ()` is
    // not SQL, so the empty membership is spelled FALSE rather than left to a syntax error.
    expect(clauses(["in", get("qty"), []])).toEqual(["FALSE"]);
  });

  it("leaves an `in` list with a non-number element alone, because the cast is the store's opinion", () => {
    expect(clauses(["in", get("qty"), [1, "a"]])).toEqual([]);
  });

  it("leaves an `in` list with a null element alone, whose membership the two sides disagree on", () => {
    expect(clauses(["in", get("qty"), [1, null]])).toEqual([]);
  });

  it("leaves an `in` list on a nullable column alone", () => {
    expect(clauses(["in", get("weight"), [1, 2]])).toEqual([]);
  });

  it("leaves an `in` list on a non-integer column alone", () => {
    expect(clauses(["in", get("price"), [1, 2]])).toEqual([]);
  });

  it("leaves an oversized `in` list alone rather than binding a thousand parameters", () => {
    // The bound is the driver's parameter limit, not a semantic one. Unpushed is a superset,
    // which is the only direction the store is allowed to err in.
    expect(clauses(["in", get("qty"), Array.from({ length: 1001 }, (_, i) => i)])).toEqual([]);
  });

  it("combines the new pushdowns inside an and chain, numbering the parameters in order", () => {
    const query = builder().buildFind("Item", undefined, {
      where: ["and", ["!=", get("qty"), 0], ["in", get("qty"), [1, 2]], [">", get("qty"), 0]] as never
    });

    expect(query.dataQuery.sql).toContain("qty <> $1 AND qty IN ($2, $3) AND qty > $4");
    expect(query.dataQuery.values).toEqual([0, 1, 2, 0]);
  });
});
