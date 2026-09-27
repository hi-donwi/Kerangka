# ADR-0031: First-Class Multi-Tenancy and Tenant Overlays

- **Date:** 2026-09-27
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

Enterprise SaaS applications require bulletproof tenant isolation. Ad-hoc query filtering frequently leads to catastrophic data leaks across tenants.

## Decision

Multi-tenancy is declared at the document root with strategies: `discriminator` (row-level, H1), `schema`, and `database` (H2). The engine automatically injects tenant filters into all store queries and writes. Horizon 2 introduces Tenant Overlays for per-tenant customization without forking.

## Consequences

### Positive
- Tenant isolation guaranteed by construction; prevents accidental data leaks.

### Negative
- Store port adapters must support dynamic schema/connection routing for enterprise strategies.

### Neutral
- Single-tenant applications simply omit the `multitenancy` declaration.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Manual query filters in user documents | Prone to developer omission and severe data leakage bugs. |

## Follow-up

- [x] Recorded in PLAN.md §22
- [ ] Conformance test cases written
- [ ] Tier 1 engine implementations verified
