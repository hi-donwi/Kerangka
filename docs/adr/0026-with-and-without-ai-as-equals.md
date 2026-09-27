# ADR-0026: With and Without AI as Equals

- **Date:** 2026-09-27
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

Over-indexing on AI generation risks creating a tool that humans cannot inspect or debug, while ignoring AI neglects the biggest development multiplier.

## Decision

Every Kerangka feature is 100% usable, readable, and testable by a person writing JSON/YAML by hand. AI assistants are first-class accelerators (via schema, MCP, repair hints, and change agents), but are never a dependency.

## Consequences

### Positive
- Humans retain complete agency and comprehension; AI gains a safe, deterministic target format.

### Negative
- Requires keeping authoring syntax readable and clean for human editing.

### Neutral
- Every tutorial level and CLI command must be completable without AI.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| AI-only generation target with opaque internal representations | Creates unmaintainable systems when AI hallucinates. |

## Follow-up

- [x] Recorded in PLAN.md §22
- [ ] Conformance test cases written
- [ ] Tier 1 engine implementations verified
