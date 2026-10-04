# ADR-0041: A Denied Equality and a Literal List Push Down Under the Same Two Conditions

- **Date:** 2026-10-04
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

ADR-0039 made predicate pushdown a one-directional obligation — a store may push only what is
**implied by** the engine's evaluation; it may return a superset, never a subset — and within
that rule it pushed the four orderings (`<`, `<=`, `>`, `>=`) onto a field that is both
`required` and of an allowlisted type (`int`/`integer`). Two operators were left outside, each
gated on a decision rather than by oversight:

- `!=` was excluded "pending a decision on NULL". A row whose column is NULL is kept by
  `item[k] !== v`, dropped by `<>`, dropped by `!=` — two of the three agree, not for the same
  reason. As long as that row can exist, the pushed clause is stricter than the engine.
- `in` was excluded "because it is a disjunction". The reasoning was borrowed from `or`, whose
  operands are not necessary conditions and may never be pushed.

The Phase 2 handoff listed both as the first remaining pushdown work. Deciding them is this
ADR's purpose; implementing the decision is the code that accompanies it.

While writing the tests for `!=`, a latent violation in the already-pushed orderings surfaced:
a comparison whose right side is `null`. The engine answers through `compare`'s string
fall-through — `String(5) > String(null ?? "")` is `"5" > ""`, true, the row is kept — while
SQL answers `col > NULL` with NULL and drops every row. Pushed, the store is the stricter of
the two for the least defensible reason there is: the value is not a value. That hole is closed
here, because the decision that gates `!=` is the same one that closes it.

## Decision

**`!=` and `<>` push under the same two conditions as the orderings, plus a value gate.**

- The field is `required` in the KIR, so the column is `NOT NULL` and no NULL row can exist;
  and the field's type is in the same allowlist as before (`int`/`integer`). On such a column,
  `<>` and `!==` agree on every row the store can hold, because the row that made them
  disagree cannot exist.
- The value must be a number. `5 !== "5"` keeps every row — `!==` never equates across types —
  while `qty <> '5'` casts and drops the fives. The orderings get away with a string literal
  only because their engine answer falls through to the same lexicographic compare;
  `!=` has no such agreement, so its gate is tighter from birth. A NULL, a missing value, or a
  non-number value means the clause is not pushed.

**A literal-list `in` pushes as `col IN ($n, ...)`, under the same two conditions plus two
list gates.**

- The disjunction ADR-0039 worried about is an `or`, whose operands need not hold — neither
  operand is necessary, so neither is implied. A membership test over one column is different:
  the whole predicate must hold, and on a NOT NULL column of an allowlisted type, `list.includes`
  and SQL `IN` evaluate it the same way. The pushed clause is implied, not stricter.
- Every element must be a number, and none may be NULL. `pg` casts list elements to the column
  type; a cast the engine does not perform turns a row-level false into a query-level error,
  and SQL membership of NULL is never true while the engine's `includes` would match an
  undefined field.
- An empty list pushes as `FALSE`. `[].includes(v)` is false for every value, so the store may
  narrow to nothing; `IN ()` is not SQL, so the empty membership is spelled FALSE rather than
  left to a syntax error.
- Past 1000 elements the clause is not pushed. The bound is the driver's parameter limit, not
  a semantic one, and unpushed is a superset — the only direction the store may err in.
- Expansion over `= ANY($1)`: the executor is an interface, and array binding is a driver
  courtesy. One parameter per element is portable.

**A NULL or missing right side never pushes, for any operator.** This closes the latent hole in
the orderings: `col > NULL` drops every row that the engine's string fall-through keeps. A
clause whose value is not a value has no engine-evaluated meaning to be implied by.

**What stays decided against:** `in` over an expression or a field is not a literal and does
not push. `decimal`, text, and temporal columns stay out — ADR-0039's coercion and collation
reasons are untouched by this ADR, and the numeric-as-string question remains theirs.

## Consequences

### Positive

- Range, inequality, and membership predicates over required integer columns narrow in the
  store; a named query over a large table stops reading every row into the adapter.
- The NULL hole in the already-pushed orderings is closed by a test that pins it, not by
  an argument in a comment.
- The invariant is unchanged and now tested from more angles: every push is still implied,
  every refusal is still a superset.

### Negative

- Two more gates to maintain: the value-type gate on `!=`, and the element/length gates on
  `in`. Each is a sentence in this ADR and an assertion in the suite.
- `decimal` still scans in memory. The coercion question — `pg` returns NUMERIC as a string,
  the engine then compares lexicographically — remains the most expensive open item, and it is
  a runtime correctness question before it is a pushdown question.

### Neutral

- `evaluateWhereInMemory` still re-evaluates the full predicate over whatever the store
  returns. Redundant for the pushed conjuncts, and it is what makes every partial pushdown
  sound. It stays.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Push `!=` on nullable columns as `col <> $1 OR col IS NULL` | Sound — it is exactly the engine's answer — but it widens the surface (every type, not just the allowlist) before the coercion question is answered, and the `required` gate already covers the common case. Revisit when the type allowlist widens. |
| Push `in` as `= ANY($1)` | One bound parameter instead of N, but array binding behaviour differs across drivers and the executor is an interface. Expansion is portable and the parameter budget is bounded by the 1000-element cap. |
| Decide NULL by making the engine treat an absent value as non-matching for `!=` | Changes in-process query results for every store, not only the pushed path. ADR-0039 already reserved that change for its own ADR and its own evidence. |
| Widen `QueryFilter` to carry operator clauses | Rejected in ADR-0039 and still rejected: a filter whose consumers must tell a bare value from a clause is a permanently ambiguous type. |
| Leave `!=` and `in` in memory | Defensible — `evaluateWhereInMemory` is correct — but the membership test is the most common shaped predicate after equality, and the decision was already owed. |

## Follow-up

- [ ] Answer the `numeric`-as-string coercion question, then reconsider `decimal` pushdown.
      This also gates `!=` and `in` on `decimal` columns, where they would otherwise be sound.
- [ ] `readFilter` itself is not yet pushed as row-level security in the database;
      ADR-0039's follow-up stands unchanged.
- [ ] The broad `catch` in `adapter-hono/src/hono-app.ts` returning `422 QUERY_INVALID` for
      any throw remains open and independent.
- [ ] Non-integer types for `!=` and `in` (text equality needs no collation decision, but the
      allowlist is shared with the orderings, which do): decide per-type, not in bulk.
