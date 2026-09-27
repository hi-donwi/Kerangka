# ADR-0002: Canonical IR with a Single TypeScript Compiler

- **Date:** 2026-09-27
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

Supporting five native languages (TypeScript, Java, Python, Dart, Go) could require five compilers, which risks semantic divergence and creates an unmaintainable burden for a small team.

## Decision

We build a single canonical compiler in TypeScript that compiles authoring documents (`*.kerangka.json` and `*.kerangka.yaml`) into a flat, typed, fully resolved Intermediate Representation (`*.kir.json`). Engines in all target languages only consume IR and contain zero parsing or module-resolution logic.

## Consequences

### Positive
- Single source of truth for validation and type-checking; engines stay tiny (≤ 3,000 lines), pure, and easy to maintain.

### Negative
- Running the compiler requires Node.js/TypeScript toolchain, though a precompiled sidecar and binary distributions alleviate this for non-JS environments.

### Neutral
- Engines are completely decoupled from authoring shorthands, traits, and module resolution.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| A compiler per language | Five separate compilers guarantee semantic drift and require five times the maintenance effort. |
| A Rust compiler first | Slows down initial iteration speed during spec 0.1–0.3; TypeScript can later be compiled to standalone binaries or rewritten in Rust in Horizon 2. |

## Follow-up

- [x] Recorded in PLAN.md §22
- [ ] Conformance test cases written
- [ ] Tier 1 engine implementations verified
