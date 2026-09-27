# ADR-0013: Package Distribution via npm and Git

- **Date:** 2026-09-27
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

Kerangka needs a distribution mechanism for reusable packages (`@kerangka/std`, accounting, domain packs) without building and maintaining a custom package registry on day one.

## Decision

Packages are distributed using existing package ecosystems (npm registries and direct Git repositories), pinned with cryptographic hashes in `kerangka.lock`.

## Consequences

### Positive
- Zero infrastructure cost for package hosting; leverages mature caching, private mirrors, and vulnerability scanning.

### Negative
- Non-JS developers must interact with npm/git semantics during package installation.

### Neutral
- A dedicated Kerangka Hub registry is deferred to Horizon 2.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Building a custom package registry from scratch in v1.0 | Massive distraction from core language and engine development. |

## Follow-up

- [x] Recorded in PLAN.md §22
- [ ] Conformance test cases written
- [ ] Tier 1 engine implementations verified
