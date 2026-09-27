# ADR-0014: First-Class Decision Tables

- **Date:** 2026-09-27
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

Complex pricing, fee structures, and multi-variable business policies become unreadable when forced into nested `if-else` expressions.

## Decision

We introduce first-class decision tables adopting a clean DMN-style subset with cell tests and standard hit policies (`first`, `unique`, `collect`). Decision tables support spreadsheet-like grid viewing and round-trip CSV import/export.

## Consequences

### Positive
- Complex multi-condition logic is legible to non-programmers; static analysis can prove coverage gaps and overlapping rows.

### Negative
- Requires dedicated parser rules and static verification logic in the compiler.

### Neutral
- Decision tables compile into deterministic lookup trees in the IR.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Nested ternary and if expressions only | Quickly degenerates into unreadable 'spaghetti JSON' in enterprise applications. |
| Full DMN standard with FEEL language | Excessively large specification that violates the 25-concept budget. |

## Follow-up

- [x] Recorded in PLAN.md §22
- [ ] Conformance test cases written
- [ ] Tier 1 engine implementations verified
