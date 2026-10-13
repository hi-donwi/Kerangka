# ADR-0044: Role-Map Permissions Are Enforced, and an Empty List Grants No One

- **Date:** 2026-10-12
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

An entity's `permissions` name, per operation, who may perform it. PLAN.md §5.1 writes them in
two forms, and the invoicing example uses both:

```json
"permissions": {
  "read":   ["admin", "billing", "viewer"],
  "update": { "admin": true, "billing": "status == 'draft'" },
  "delete": ["admin"]
}
```

`Engine.canOperate`, which the HTTP adapter calls before every create, read, update, and
delete, only understood the list. It returned "allowed" whenever the declared value was not a
non-empty array, so:

- a **role map** allowed every caller. A `viewer` could `PUT` an invoice that the model said
  only `admin`, and `billing` on drafts, may change;
- an **empty list**, which reads as "no one", allowed every caller too.

Both failed open, on the path that carries the authority. ADR-0008 makes fail-closed the rule
for guards and permissions; this was the exception nobody had tested.

## Decision

- An operation the model does not mention stays **open**, as before: permissions are opt-in
  per operation, and changing that would close every endpoint of every existing model.
- A **list** grants exactly the roles it names. An **empty list grants no one**.
- A **role map** grants a role mapped to `true`; `false` is an explicit refusal (the structural
  layer now accepts it, as its own message always said). A role mapped to a string is a
  **condition on the record**: `canOperate(entity, op, actor, record)` evaluates it, and a
  condition that cannot be parsed or evaluated grants nothing.
- Without a record, a grant that only a condition could give answers
  **`PERMISSION_NEEDS_RECORD`** rather than guessing. The HTTP adapter then decides against the
  record: the request body for create, the stored record (before the change) for update,
  delete, and a single read.
- A **list or a named query** cannot apply a per-record read condition without reading rows the
  caller may not see, and filtering afterwards would make totals and pages lie. It is refused
  with advice to declare the condition as the entity's `readFilter`, which is pushed into the
  store (ADR-0040).

## Consequences

### Positive

- The two documented forms mean what they say on the HTTP path; five adapter tests that fail
  against the previous engine prove it.
- "Billing may update drafts" is decided against the stored record, so it cannot be bypassed by
  sending `"status": "draft"` in the body of an update to a sent invoice.

### Negative

- A model that relied on the fail-open behaviour (a role map or an empty list it did not mean)
  now refuses those callers. That is the intended correction.
- A caller with only a conditional `read` grant can no longer list; the condition belongs in a
  `readFilter`.

### Neutral

- The Go, Python, and Dart engines have no expression evaluator yet. They follow this ADR as far
  as they can without one and refuse the rest: the Go server applies role lists and role maps,
  and answers 501 for a conditional grant or a read filter it cannot evaluate; all three refuse
  a guarded transition with `GUARD_UNSUPPORTED`. Evaluating conditions there is part of the
  Tier 1 engine work.

## Amendment (2026-10-13): the server `kerangka serve` and `kerangka dev` run

The Hono adapter was fixed first, but `KerangkaServer` (what `kerangka serve` and
`kerangka dev` start) implements REST and MCP on its own, and it enforced none of this: no
entity permissions on any CRUD path, no read filter on a list or a single read (ADR-0040), MCP
`create`/`update` stored records without validation, and a request with no actor ran an action
as `{ roles: body.roles || ["admin", "billing"] }` and an MCP transition as `admin`.

- REST and MCP now authorize exactly as the Hono adapter does, using the same read-filter
  evaluation (`evaluateWhereInMemory`, `equalityConstraints` from `@kerangka/adapter-hono`).
  MCP tools take their actor from `actorId`, `roles`, and `tenantId` in their arguments, and
  MCP create and update validate what they would store.
- A request that names no actor holds **no role**. The convenience of acting without one is
  the explicit `devActor` server option: `kerangka dev` sets it to a user holding every role the
  model declares, so its playground still drives guarded actions; `kerangka serve` never does,
  and a deployed host sets `X-Actor-Id`/`X-Actor-Roles` from its own authentication.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Filter list results by the read condition | Counts and pages would not match what the caller receives, and every page would read rows the caller may not see |
| Treat a missing operation as closed | Correct in isolation, but it closes every existing model's undeclared operations at once; an ADR of its own if wanted |
| Evaluate an update condition against the merged record | The body could then grant itself the right to change a record it may not change |
