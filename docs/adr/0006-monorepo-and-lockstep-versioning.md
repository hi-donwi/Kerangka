# ADR-0006: Monorepo with Lockstep Minor Versioning

- **Date:** 2026-09-27
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

Coordinating multiple SDKs, compiler packages, and conformance test suites across separate repositories creates dependency hell and version mismatch.

## Decision

We maintain the specification, compiler, CLI, Tier 1 engines, and conformance suite in a single monorepo (`hi-donwi/Kerangka`), releasing all packages with lockstep `major.minor` versions.

## Consequences

### Positive
- Atomic pull requests touching spec, compiler, and conformance tests; absolute version clarity for users.

### Negative
- Requires multi-language build tooling in CI (npm, Maven, poetry, pub, go).

### Neutral
- Individual engine patch versions may vary, but minor versions always match the specification release.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| One repository per language | Creates coordination friction, stale engines, and broken conformance tests. |

## Follow-up

- [x] Recorded in PLAN.md §22
- [ ] Conformance test cases written
- [ ] Tier 1 engine implementations verified
