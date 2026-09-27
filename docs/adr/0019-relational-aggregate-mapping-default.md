# ADR-0019: Relational Aggregate Mapping Default

- **Date:** 2026-09-27
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

Traditional heavy ORMs produce severe N+1 query problems and object-relational impedance mismatch, while pure document stores lack relational query power.

## Decision

We map one aggregate root to one primary table row. Scalar fields become queryable columns; embedded collections default to a JSON column loaded and saved atomically with the root. Child tables are opt-in via `"storage": "tables"` when indexing is required.

## Consequences

### Positive
- High write performance with single-row atomic commits; zero N+1 queries for aggregate hydration.

### Negative
- Querying deeply nested embedded JSON fields requires JSON query support in the relational database.

### Neutral
- Automatic optimistic locking via a mandatory `version` integer column.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Fully normalized tables for all embedded lists by default | Causes excessive table joins and complicated multi-table transaction locks for simple aggregates. |

## Follow-up

- [x] Recorded in PLAN.md §22
- [ ] Conformance test cases written
- [ ] Tier 1 engine implementations verified
