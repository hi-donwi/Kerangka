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
 * See ADR-0039 for the invariant and for why the type allowlist is as short as it is.
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

  it("leaves `!=` alone, pending a decision on NULL", () => {
    // Three implementations disagree about a NULL column: kept by `item[k] !== v`, dropped by
    // `<>`, dropped by `!=`. Two agree, not for the same reason.
    expect(clauses(["!=", get("qty"), 1])).toEqual([]);
  });

  it("leaves a disjunction alone, because neither operand is necessary", () => {
    const query = builder().buildFind("Item", undefined, {
      where: ["or", [">", get("qty"), 1], ["<", get("qty"), 100]] as never
    });

    expect(query.dataQuery.sql).not.toContain("qty");
    expect(query.dataQuery.values).toEqual([]);
  });

  it("leaves `in` alone, because it is a disjunction", () => {
    expect(clauses(["in", get("qty"), [1, 2, 3]])).toEqual([]);
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
