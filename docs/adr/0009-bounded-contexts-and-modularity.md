# ADR-0009: Bounded Contexts as the Unit of Modularity

- **Date:** 2026-09-27
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

As applications grow, monolithic namespaces lead to tight coupling, circular dependencies, and tangled databases.

## Decision

We structure multi-file applications around Bounded Contexts. Each context resides in its own directory, declares an explicit public API via `exports`, and references other contexts strictly through IDs. Cross-context structural dependencies must form a Directed Acyclic Graph (DAG).

## Consequences

### Positive
- Domain-Driven Design (DDD) enforced at the compiler level; contexts can be split from a monolith into microservices without rewriting models.

### Negative
- Forbids direct joins or multi-aggregate transactions across contexts.

### Neutral
- Single-file documents remain fully supported for small utilities and prototypes.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Single global namespace with conventions | Quickly degenerates into an unmaintainable distributed monolith. |

## Follow-up

- [x] Recorded in PLAN.md §22
- [ ] Conformance test cases written
- [ ] Tier 1 engine implementations verified
