# ADR-0010: Single-Aggregate Transactions and Eventual Consistency

- **Date:** 2026-09-27
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

Multi-table distributed locks cause severe scalability bottlenecks and deadlocks in modern distributed systems.

## Decision

An action executes within the boundary of exactly one aggregate root. Changes to other aggregates must occur asynchronously via domain events and reactive `policies`.

## Consequences

### Positive
- Guarantees horizontal scalability, eliminates distributed two-phase commits, and maps cleanly to relational row-level locking.

### Negative
- Cross-aggregate workflows must be modeled as sagas with compensating actions.

### Neutral
- Optimistic concurrency (`version` column) protects the single aggregate transaction from race conditions.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Distributed multi-aggregate ACID transactions | Severely limits throughput and fails when services are distributed across networks. |

## Follow-up

- [x] Recorded in PLAN.md §22
- [ ] Conformance test cases written
- [ ] Tier 1 engine implementations verified
