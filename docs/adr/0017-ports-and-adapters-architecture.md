# ADR-0017: Ports and Adapters with Database-Only Starter Profile

- **Date:** 2026-09-27
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

Forcing heavy external infrastructure (Redis, Kafka, S3) on small projects raises the barrier to entry, while locking into a single database prevents enterprise scale.

## Decision

We adopt hexagonal architecture: fixed ports (Store, Cache, Bus, Scheduler, Realtime, Files, Secrets, Telemetry) backed by swappable adapters. The Starter profile runs entirely on a single database (PostgreSQL or SQLite) without Redis or a message broker.

## Consequences

### Positive
- Projects start with zero infrastructure overhead and scale to distributed enterprise topologies by changing adapter configuration.

### Negative
- Requires maintaining test kits for each port to certify community adapters.

### Neutral
- The engine and domain model never change across infrastructure profiles.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Requiring Redis and message brokers from day one | Kills adoption for small tools, single-file prototypes, and lightweight edge apps. |

## Follow-up

- [x] Recorded in PLAN.md §22
- [ ] Conformance test cases written
- [ ] Tier 1 engine implementations verified
