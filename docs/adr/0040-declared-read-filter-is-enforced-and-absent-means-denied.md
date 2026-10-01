# ADR-0040: A Declared Read Filter Is Enforced, and Absent Means Denied

- **Date:** 2026-10-01
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

`PLAN.md` states two things that the runtime does not do.

- §1949 lists the mitigation for row-level leaks as: "`readFilter` predicates are pushed into
  queries by adapters."
- §1544–1545 lists `app.readFilter(entity, actor) → Predicate` as returning a predicate "for
  adapters to push into queries," with `readFilter` already applied in `queryPlan`.

ADR-0008 says every permission check fails closed, and ADR-0031 makes tenant scoping a
first-class property. `readFilter()` exists in `engine-ts/src/engine.ts:1425` and `queryPlan()`
does call it (`engine.ts:1497`). The gap is between that and a request. Four distinct defects
were reproduced against `createKerangkaHonoApp` with a model declaring both controls:

```json
{ "readFilter": "tenantId == actor.tenantId",
  "permissions": { "read": ["admin"], "create": ["admin"],
                   "update": ["admin"], "delete": ["admin"] } }
```

Seeded with one `Doc` for `acme` and one for `globex`, then called with **no** `X-Actor-Id`,
**no** `X-Actor-Roles`, and **no** `X-Tenant-Id` header:

| Request | Result |
|---|---|
| `GET /api/doc` | **200** with both tenants' rows |
| `GET /api/doc/d-acme` | **200** with the `acme` row |
| `POST /api/doc` | **201**, created |
| `DELETE /api/doc/d-acme` | **204**, deleted |

An anonymous caller read across the tenant boundary. Nothing errored, nothing was logged, and
the response was a well-formed 200 — the worst shape a failure can have, because no consumer of
the API can tell it from a success.

The four causes, separately.

**1. The entity's own `readFilter` is silently dropped.** The compiler stores it as a string
(`types.ts:173`, `readFilter?: string`), and merges traits by string concatenation
(`compiler.ts:409`). The engine only accepts the object form:

```ts
// engine.ts:1456
if (entity.readFilter) {
  if (typeof entity.readFilter === "object") {   // never true: it is a string
    conditions.push(entity.readFilter as ExprNode);
  }
}
```

The branch is unreachable. An author who wrote a read filter is running with no read filter, and
nothing reports it.

**2. Tenant scoping fails open.** `engine.ts:1437` adds the tenant constraint only when
`actor?.tenantId !== undefined`. An absent actor is treated as "no constraint" rather than as
"no authorization", so the one request that should be refused is the one that sees everything.
ADR-0008 requires the opposite.

**3. The REST collection and item paths never consult `readFilter` at all.**
`hono-app.ts:300` (`GET /api/:entity`) calls `store.find` directly, with the query string and
`tenantId`; `hono-app.ts:519` (`GET /api/:entity/:id`) calls `store.get`. Neither goes through
`readFilter()` or `queryPlan()`. Only the named-query path (`hono-app.ts:430`) does. So defect 2
is unreachable on the ordinary REST surface, and the soft-delete constraint is unreachable there
too — a soft-deleted row is returned by a plain `GET`.

**4. `entity.permissions` is never enforced.** The only runtime role check is
`engine.ts:753`, over an action or transition's `roles`. An entity's `permissions` map is read by
the verifier to warn about unused roles and by nothing that decides a request. A `delete`
restricted to `admin` is decorative.

There is a fifth problem underneath all four, and it is the reason this is an ADR rather than a
patch. **The codebase has two AST representations.** `@kerangka/k1`'s `compileExpression` returns
`{$expr, args}`; the engine's `readFilter`, `query-eval`, and `ports.QueryPredicate` use tuples
`["op", left, right]`. And an author writes `actor.tenantId`, which is a path into the *actor*,
not a field of the record:

```
"tenantId == actor.tenantId"  =>  {"$expr":"==","args":[{"$bind":"tenantId"},{"$bind":"actor.tenantId"}]}
```

Lowered naively to the tuple form that is `["==", ["get","tenantId"], ["get","actor.tenantId"]]`,
and `["get", …]` reads a *record* field. `["get", "actor.tenantId"]` is `undefined` on every row,
so the predicate silently matches nothing — and a filter that matches nothing is a filter that
leaks nothing, which is the one accident that would have hidden this bug from a security review
while producing an entirely broken API. Any fix has to resolve actor paths deliberately.

## Decision

**The engine owns the decision, and it is decided once, at compile time.**

1. **A declared `readFilter` is parsed at compile time and carried as a predicate.** The compiler
   calls the existing `@kerangka/k1` `compileExpression` — already a dependency, no new parser —
   and lowers the result into the engine's tuple form. The IR then carries a structured
   predicate, the unreachable `typeof === "object"` branch becomes live, and trait merging ANDs
   two predicates instead of concatenating two strings. A malformed `readFilter` becomes a
   **compile-time diagnostic** rather than a string that silently does nothing.

2. **Actor paths are their own node, not a record read.** The lowering emits `["actor", path]`
   for `actor.<path>`, and both the engine's evaluator and `adapter-hono`'s `query-eval` resolve
   that node against the actor. This is the one addition to the tuple AST, and it is deliberately
   explicit: a path that means "the caller" must not be spelled the same way as a path that means
   "this row", because the failure is a security failure and spelling it identically is how it
   gets confused.

3. **Absent is denied, on a tenant-scoped entity.** `readFilter()` on a tenant-scoped entity with
   no `actor.tenantId` yields no predicate and the adapter **rejects the request**; it does not
   proceed unscoped. An entity with no tenant scope and no read filter is still public, because
   that is what it declares. This is ADR-0008 applied to scoping, and it is the change that turns
   the table above from a leak into a 403.

4. **Every read path goes through `readFilter()`.** `GET /api/:entity` and
   `GET /api/:entity/:id` do not call `store` directly. The collection reads through the same
   plan-building path the named-query route uses, so tenant scope, soft delete, and the entity's
   read filter cannot be bypassed by choosing a different URL. `GET` by id additionally verifies
   the row against the predicate, because a scoped store that is wrong must not become a 404 that
   hides a 403.

5. **`entity.permissions` is enforced per operation, in the engine, fail-closed.** One helper
   next to the existing `can()` decides `read`/`create`/`update`/`delete` from the actor's roles.
   Undenied means the request is refused; an entity that declares no `permissions` is unrestricted,
   because that is what it declares. The five REST operations and the named-query path all
   consult it.

6. **Header-derived actors are the dev harness, and are documented as such.** `X-Actor-Id`,
   `X-Actor-Roles`, and `X-Tenant-Id` are self-asserted, so they are a development affordance and
   never a production identity. The adapter's contract is that a host supplies a verified
   principal; the change here is that **absence of a principal is no longer read as
   authorization**, which is what makes the harness safe to leave in place while a real identity
   is built. Designing that identity is out of scope and belongs to its own decision.

## Consequences

### Positive

- A model's declared `readFilter` and `permissions` do something, or the compiler says why not.
- A tenant-scoped entity cannot be read by a request that has not established a tenant, so the
  default is a refusal rather than a full table scan.
- Soft delete and tenant scope stop being bypassable by URL, because the read path is the same
  path.
- A bad `readFilter` is a build failure, at the point where it can still be fixed by the author.

### Negative

- `readFilter` in the IR changes from `string` to a predicate. That is a breaking change to a
  published contract, taken deliberately at `0.1`: a security predicate that is silently ignored
  is worse than a documented break, and this is the smaller cost.
- `["actor", path]` is a new node in the tuple AST, which ADR-0003 fixes. Every consumer of that
  AST must handle it, and any that does not will treat an actor path as a record field. This is
  the sharpest edge of the decision and the first thing to review.
- `GET /api/:entity` and `GET /api/:entity/:id` change shape, because they now plan rather than
  pass through. A caller that depended on the unfiltered list will start seeing fewer rows, which
  is the point and is still a behaviour change.
- Models that declare a `readFilter` the compiler cannot lower will now fail to compile, where
  before they compiled and did nothing.

### Neutral

- Nothing here chooses an authentication mechanism. The adapter keeps reading headers for
  development; what changes is that a request without a principal no longer succeeds by default
  on a scoped entity.
- The Postgres pushdown from ADR-0039 is unaffected. A `readFilter` that ANDs in actor equality
  reaches `store.find` as part of the plan's `where`, and the existing narrowing-only rule applies
  to it unchanged.
