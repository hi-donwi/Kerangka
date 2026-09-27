# Kerangka Conformance Test Suite

Specification Version: 0.1
Status: Draft
License: CC BY 4.0 (test specifications) / Apache-2.0 (harness code)

## Overview

The Kerangka conformance test suite provides language-neutral test fixtures in JSON format to guarantee that any Kerangka compiler or engine implementation (TypeScript, Go, Java, Rust, Python, etc.) adheres strictly to the specification.

## Structure

```
conformance/
├── README.md                          # Documentation and instructions
├── schema/
│   └── conformance-suite.schema.json  # Schema for test case definitions
├── cases/
│   ├── k1-expressions.json            # Infix syntax, AST output, and evaluation
│   ├── shorthand-expansion.json       # Field shorthand to canonical definition
│   ├── workflow-transitions.json      # State machines, roles, and guards
│   └── validation-rules.json          # Field validation, rules, and invariants
└── conformance.test.ts                # TypeScript reference test runner
```

## Running the Conformance Suite

Run with npm/vitest:
```bash
npm run test:conformance
```
or via the root vitest suite:
```bash
npx vitest run conformance
```
