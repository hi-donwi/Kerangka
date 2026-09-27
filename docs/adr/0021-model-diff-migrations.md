# ADR-0021: Automated Migrations from Model Diffs

- **Date:** 2026-09-27
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

Hand-writing database migrations is error-prone and frequently leads to drift between the domain model and database tables.

## Decision

We generate forward migrations from model diffs (`kerangka db diff`). Fields declare `renamedFrom` to prevent drop-and-add data loss; destructive steps require explicit approval; output supports plain SQL, Flyway, and Alembic.

## Consequences

### Positive
- Database schema stays 100% in sync with the domain model; prevents accidental data loss.

### Negative
- Complex data restructuring still requires custom JSON backfill statements.

### Neutral
- Generated migrations can be reviewed and edited prior to execution.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Hand-written migrations only | Leads to drift and breaks the single-source-of-truth promise. |

## Follow-up

- [x] Recorded in PLAN.md §22
- [ ] Conformance test cases written
- [ ] Tier 1 engine implementations verified
