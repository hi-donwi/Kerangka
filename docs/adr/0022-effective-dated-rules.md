# ADR-0022: Effective-Dated Rules and Decision Tables

- **Date:** 2026-09-27
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

Tax rates, shipping fees, and discount policies change over time. Historical invoices must be calculated using the rules that were in effect on their invoice date, not today's date.

## Decision

Rules and decision tables support `versions` with `validFrom` and optional `validTo`. The effective date is an explicit input field (e.g. `issuedOn`, defaulting to `ctx.now`), guaranteeing deterministic historical re-computation.

## Consequences

### Positive
- Legal and tax compliance for historical records; verify tool detects overlapping periods or temporal gaps.

### Negative
- IR compiler must store and evaluate date-ranged version arrays.

### Neutral
- Publishing new rule versions without code redeployment is supported in Horizon 2.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Overwriting rules in place | Breaks historical calculation auditability. |
| Clock-dependent evaluation | Destroys deterministic replay testing. |

## Follow-up

- [x] Recorded in PLAN.md §22
- [ ] Conformance test cases written
- [ ] Tier 1 engine implementations verified
