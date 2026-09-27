# RFC-XXXX: [Feature or Change Title]

- **Author(s):** [Name / GitHub handle]
- **Created:** YYYY-MM-DD
- **Status:** Draft | In Review | Accepted | Rejected | Implemented
- **Target Specification Version:** [e.g. 0.2 / 1.0 / Horizon 2]

## Summary

A short 2–3 sentence explanation of the proposed change.

## Problem Statement and Motivation

What problem does this solve? Why is existing Kerangka JSON / IR insufficient? Provide concrete use cases.

## Proposed Design

Detailed description of the syntax, behavior, and IR transformation.

### Syntax in `*.kerangka.json`

```json
{
  "example": "new syntax here"
}
```

### Transformation to IR (`*.kir.json`)

How the compiler transforms this shorthand into canonical intermediate representation.

### Semantics and Execution

How engines must evaluate this feature. Specify edge cases: null handling, boundary conditions, type rules, ordering.

## Concept Budget Impact

Kerangka strictly bounds the language to 25 concepts.
- Does this introduce a new concept?
- Does it replace or consolidate an existing concept?
- Why does it justify inclusion rather than using an escape ladder (connector, package, or Wasm extension)?

## Conformance and Cross-Engine Impact

- What new conformance test cases are required?
- Does this impact Tier 1 engines (TypeScript, Java, Python, Dart, Go)?
- Are there cross-platform differences that need normalization?

## Compatibility and Migration (Expand/Contract)

- Is this backward-compatible with existing models?
- Does it require a breaking change? If so, what is the two-phase migration plan?

## Alternatives Considered

What other approaches were evaluated, and why were they rejected?
