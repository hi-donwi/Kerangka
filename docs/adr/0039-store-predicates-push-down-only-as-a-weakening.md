# ADR-0039: Store Predicates Push Down, But Only as a Weakening

- **Date:** 2026-10-01
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

`StorePort.find` takes a `QueryFilter`, declared in `ports/src/store.ts` as

```ts
export interface QueryFilter {
  [field: string]: unknown;
}
```

Every implementation treats it as an equality map and nothing else. `MemoryStore.find` applies
`if (item[k] !== v) return false`; `PostgresQueryBuilder.buildFind` emits `` `${toSnakeCase(k)} = $n` ``.
The one place that populates a `QueryFilter` from a model is `adapter-hono`, whose
`equalityConstraints` lifts `==` out of a query plan's `where` under `and` and hands the result to
the store. Comparisons — `>`, `>=`, `<`, `<=`, `!=`, `in` — are evaluated afterwards, in process,
by `evaluateWhereInMemory`.

So a named query with a `where` reads the whole table. `PLAN.md` §1544 already specifies the
intended shape: "`app.readFilter(entity, actor) → Predicate` — Row-level read predicate as an AST,
for adapters to push into queries." The implementation is a fraction of that, and the previous
handoff recorded the remainder as a mechanical follow-up to `adapter-hono/src/query-eval.ts`.

It is not mechanical. `QueryFilter` cannot express a comparison, and both implementations are
written against the equality reading. The two obvious shapes for fixing that are a new `where`
parameter carrying an AST, or a wider `QueryFilter` carrying operator clauses. The choice decides
how every store is written from here, so it is recorded before any code moves.

## The hazard that decides it

Pushdown is a performance optimisation sitting in front of a correctness decision, and the two
can disagree. The engine evaluates a predicate through `matchesExpr` in
`adapter-hono/src/query-eval.ts`; a store that pushes the same predicate down evaluates it a
second time, in its own semantics. If the store is *stricter*, it returns fewer rows than the
model says and nothing reports the difference. If it is *looser*, the adapter's in-process pass
discards the extras and the answer is still right.

So the invariant is one-directional and it is not negotiable:

> A store may only push a predicate that is **implied by** the engine's evaluation of it. A store
> that cannot honour that may return a superset, never a subset.

Most operators satisfy this by accident. `col = $1` excludes a NULL row, and
`item[k] !== v` excludes a row with the field absent, so equality is safe in both stores. The
orderings are not. `compare()` in the same file treats a missing value as `""`:

```ts
function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = String(a ?? "");
  ...
}
```

so `> 10` keeps a row whose `weight` is absent, while `WHERE weight > 10` drops it. Same predicate,
opposite answers, and which one a user sees depends on which store is wired in.

There is a second, less visible disagreement: `compare` compares anything non-numeric as a
string. `pg` returns `numeric` as a string by default, so a `decimal(12,2)` column arrives as
`"10.50"`, takes the string branch, and is compared lexicographically. `"100.00" < "20.00"` is
true as strings and false as decimals. A `required` column does not save this one.

## Decision

**The store takes a predicate. `QueryFilter` stays an equality map.**

- A predicate is the same tuple AST the engine already uses, declared in `ports` as a structural
  type. `ports` must not import `engine-ts` to get it; the form is structural, so the type is
  small and the dependency stays absent.
- `QueryFilter` is not widened. A filter wide enough to carry an operator is a filter whose
  consumers must all distinguish a bare value from a clause, and every one of them gets it wrong
  once. The equality-only reading is the reason `MemoryStore.find` is four lines.
- Only conjuncts are pushed. A disjunct is not a necessary condition, so `or` is never pushed,
  at any depth, and neither is an operator the store does not implement.
- The adapter keeps evaluating the **full** predicate after the store returns. It is already
  written that way, and it is what makes a partial pushdown safe: correctness never depends on
  the store having understood anything.

Within that, a comparison is pushable only when the two implementations agree on the column:

- the field is `required` in the KIR, so the generated column is `NOT NULL`
  (`ddl/generator.ts:212`) and "absent" cannot occur; **and**
- the field's type is one where the engine and the database compare the same way.

`!=` is excluded outright, pending a decision on NULL rather than by oversight. A row with a NULL
column is kept by `item[k] !== v`, dropped by `<>`, and dropped by `!=` — two of the three agree,
but not for the same reason, and the third is reachable through the same filter. `IN` is excluded
because it is a disjunction.

`decimal` is excluded by the second clause until the `numeric`-as-string behaviour is settled. It
is the most common range-predicate field in a ledger, so this is a real cost, and it is cheaper
than silently returning different rows than the model promises.

## Consequences

### Positive

- The invariant is stated once, in one direction, and every future store is written against it.
- A store that pushes nothing is correct by construction, not by careful effort.
- `==` keeps working unchanged; the current code is already compliant.

### Negative

- `decimal` range predicates keep scanning until the coercion question is answered. That question
  is now written down instead of lurking in `compare`.
- The type-allowlist needs maintaining as types are added, and a type that is neither allowed nor
  explicitly rejected is the ambiguous case. It defaults to not-pushed.
- `find` gains a parameter, so every `StorePort` implementation changes — one commit per package.

### Neutral

- `evaluateWhereInMemory` still re-checks the pushed conjuncts. Redundant, and it is what makes a
  partial pushdown sound. It stays.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Widen `QueryFilter` to `{ field: { op, value } }` | Smaller blast radius, but every consumer must then tell a bare value from a clause, and `!=` makes the resulting semantics unstateable in one line. It buys a smaller diff with a permanently ambiguous type. |
| Have the store evaluate the whole predicate and drop the in-process pass | Correct only if every store is trusted to be exactly right, including on the operators it does not implement. The in-process pass is the only thing standing between a partially-implemented store and wrong results. |
| Push orderings regardless of nullability | Strictly unsound per the invariant above: the store becomes stricter than the engine, and the difference is invisible. |
| Fix `compare` so an absent value is not `""` and push freely | Reasonable on its own and arguably a bug worth fixing separately — but it changes in-process query results, so it cannot ride along with a pushdown change. It needs its own ADR and its own evidence. |
| Leave it in memory and stop | Defensible. `evaluateWhereInMemory` is correct today. It was rejected only because `PLAN.md` §1544 already promises a pushable AST and a ledger query that reads the table is not what the specification describes. |

## Follow-up

- [ ] The broad `catch` in `adapter-hono/src/hono-app.ts:477` returns `422 QUERY_INVALID` for any
      throw in the named-query handler, so a dangling import inside it reports as a client error.
      It cost real time here. A test pinning that boundary is small and does not depend on this ADR.
- [ ] Answer the `numeric`-as-string coercion question, then reconsider `decimal` pushdown.
- [x] Decide NULL semantics for `!=` before it becomes pushable. Decided by ADR-0041: it
      pushes under the same two conditions as the orderings, plus a value gate.
- [ ] `readFilter` itself is not yet pushed anywhere. `PLAN.md` §1156 and §1949 describe it as
      row-level security, and today it is evaluated in process like any other predicate. That is
      a security question, not a performance one, and it deserves its own ADR.
