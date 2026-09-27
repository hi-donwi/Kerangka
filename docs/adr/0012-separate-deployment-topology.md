# ADR-0012: Separate Deployment Topology Configuration

- **Date:** 2026-09-27
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

Embedding infrastructure and service topology inside the domain model forces a rewrite of business rules when changing architecture from monolith to microservices.

## Decision

We separate architecture topology into a dedicated `deploy.kerangka.json` file. The same business model can be compiled as a modular monolith (Starter/Standard) or sliced into microservices (Distributed) solely by changing topology config.

## Consequences

### Positive
- Zero rewrite when scaling up; start simple as a single service and split when organizational boundaries demand it.

### Negative
- Requires maintaining two separate files (`kerangka.json` and `deploy.kerangka.json`) for multi-service apps.

### Neutral
- Single-file Starter applications require no deployment file at all.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Declaring service boundaries inside aggregate JSON | Tightly couples domain models to deployment topology. |

## Follow-up

- [x] Recorded in PLAN.md §22
- [ ] Conformance test cases written
- [ ] Tier 1 engine implementations verified
