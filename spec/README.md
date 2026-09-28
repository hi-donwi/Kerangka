# Kerangka Specification

- **Version:** 0.1 (Draft)
- **License:** CC BY 4.0 (Creative Commons Attribution 4.0 International)
- **Status:** In Progress (Phase 0 Foundations)

This directory contains the normative specification of the Kerangka software description standard.

## Structure

```
spec/
├── k1.ebnf                 Formal EBNF grammar for the K1 expression language
├── semantics/
│   ├── types.md            Type system and validation rules
│   ├── numbers.md          Exact decimal arithmetic and numeric constraints
│   ├── temporal.md         Temporal types, clocks, date math, and cron
│   ├── strings.md          Unicode semantics, pattern matching, canonical JSON
│   ├── expressions.md      Expression AST and evaluation rules
│   ├── rules.md            Field constraints, business rules, fail-closed validation
│   ├── computed.md         Computed fields and dependency graphs
│   ├── errors.md           Error taxonomy, RFC 9457 format, diagnostics
│   ├── modules.md          Bounded contexts, exports, and dependency graph
│   └── invariants.md       Aggregate-level integrity constraints
└── kir.schema.json         JSON Schema for the Intermediate Representation (Phase 1)
```

## Normative vs Non-Normative

- Text in `spec/` defines **normative** requirements. Implementations MUST pass all active conformance cases associated with these sections to earn the "Kerangka Compatible" certification.
- Non-normative implementation guidance and rationale live in `PLAN.md` and `docs/adr/`.
