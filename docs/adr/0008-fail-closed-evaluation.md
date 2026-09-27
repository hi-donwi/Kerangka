# ADR-0008: Fail-Closed Rules, Guards, and Permissions

- **Date:** 2026-09-27
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

Ambiguity or null values in security guards or permissions could lead to unauthorized privilege escalation if evaluated permissively.

## Decision

All permission checks, workflow guards, and business validation rules fail closed: any condition that evaluates to `null`, non-boolean, or throws an error is treated as `false`.

## Consequences

### Positive
- Prevents unauthorized data access or invalid workflow transitions caused by missing fields or syntax slips.

### Negative
- Requires authors to explicitly handle optional fields in guards using fallback defs.

### Neutral
- Failed guards produce distinct error codes (`GUARD_FAILED`, `PERMISSION_DENIED`).

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Treating null as passing (falsy leniency) | Unsafe default that leads to security holes in permissions and business logic. |

## Follow-up

- [x] Recorded in PLAN.md §22
- [ ] Conformance test cases written
- [ ] Tier 1 engine implementations verified
