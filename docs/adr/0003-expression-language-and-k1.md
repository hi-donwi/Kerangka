# ADR-0003: Expression Language: UIDL AST and K1 Extensions

- **Date:** 2026-09-27
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

Kerangka requires portable, deterministic expressions for rules, guards, calculations, and decision table cells across all five target stacks.

## Decision

We use the UIDL expression AST (v1.x) with an infix string shorthand and an additive extension set named K1 (`mod`, `neg`, `concat`, `lower`, `upper`, `trim`, `round`, `ceil`, `floor`). Expressions are bounded, non-Turing-complete, and evaluation depth is capped at 64.

## Consequences

### Positive
- Zero drift between frontend UI expressions and backend logic expressions; identical evaluation semantics across React, Flutter, and server engines.

### Negative
- Cannot perform arbitrary programming language constructs like unbounded loops or recursive functions.

### Neutral
- Complex calculations not expressible in K1 must be modeled via decision tables, connectors, or Wasm components.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Google Common Expression Language (CEL) | High quality but creates two expression engines since UIDL already has an established expression parser and conformance suite. |
| JSON Logic | Lacks typed decimals, strict temporal operations, and rich infix string syntax. |

## Follow-up

- [x] Recorded in PLAN.md §22
- [ ] Conformance test cases written
- [ ] Tier 1 engine implementations verified
