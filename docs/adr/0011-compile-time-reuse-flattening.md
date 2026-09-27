# ADR-0011: Compile-Time Reuse: Traits, Templates, and Inlining

- **Date:** 2026-09-27
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

Complex runtime inheritance hierarchies create deep indirection, performance overhead, and difficult-to-debug behaviors across different language runtimes.

## Decision

All reuse mechanisms—`traits`, parameterised `templates`, and pure `defs`—are completely flattened and inlined by the compiler into the canonical IR. The runtime engines never evaluate inheritance.

## Consequences

### Positive
- Engines remain blazing fast and simple; `kerangka expand` shows the exact unambiguous model.

### Negative
- Slightly increases the byte size of the compiled IR file.

### Neutral
- Traits provide behavioral composition without OOP inheritance pitfalls.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Runtime inheritance and mixin resolution | Adds massive complexity to every language engine and risks semantic drift between JVM, Python, and Dart. |

## Follow-up

- [x] Recorded in PLAN.md §22
- [ ] Conformance test cases written
- [ ] Tier 1 engine implementations verified
