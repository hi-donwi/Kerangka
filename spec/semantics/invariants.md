# Kerangka Semantics: Formal Invariants

- **Specification Version:** 0.1
- **Status:** Draft

## 1. Overview

While action **guards** protect individual transitions, **invariants** are aggregate-level integrity assertions that must hold across all states, after every committed action, and through data migrations.

An aggregate root is the boundary of consistency. Invariants guarantee that an aggregate can never exist in an illegal state, regardless of what sequence of actions was executed.

## 2. Declaration Syntax

Invariants are declared on entities under the `invariants` key:

```json
"invariants": [
  {
    "id": "paid_never_exceeds_total",
    "assert": "paidAmount <= totalAmount",
    "message": "Paid amount cannot exceed total invoice amount"
  },
  {
    "id": "closed_invoice_immutable",
    "when": "status == 'void' || status == 'paid'",
    "assert": "isUnchanged('lines')",
    "message": "Lines cannot be modified once an invoice is void or paid"
  }
]
```

### 2.1 Fields
- `id`: Stable identifier (kebab-case or snake_case).
- `assert`: Boolean K1 expression that must evaluate to `true`.
- `when` (optional): Predicate indicating when the assertion applies. If omitted, the assertion applies across all states.
- `message`: Human-readable error message explaining the violated constraint.

## 3. Execution Semantics

1. **Static Analysis (`kerangka verify`):**
   - The compiler performs range analysis and state-reachability checks to prove statically that no valid action sequence can violate the invariant.
   - Any provable violation fails static analysis with `INVARIANT_PROVABLY_VIOLATED`.
2. **Runtime Assertion:**
   - Immediately before committing the aggregate state to the store port, the engine evaluates all active invariants.
   - If any invariant assertion evaluates to `false` or `null`, the entire transaction is aborted, effects are dropped, and the operation fails with error code `INVARIANT_VIOLATED`.
3. **Machine-Readable Diagnostics for AI Self-Healing:**
   - Compiler and runtime invariant failures emit structured JSON diagnostics with line, column, JSON pointer, violated condition, and repair hints to enable closed-loop automated repair by AI agents.
