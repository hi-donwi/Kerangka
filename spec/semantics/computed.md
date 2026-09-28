# Kerangka Semantics: Computed Fields and Derived State

- **Specification Version:** 0.1
- **Status:** Draft

## 1. Overview

A **computed field** is an entity field whose value is automatically derived from other fields or embedded collections using a pure K1 expression.

Computed fields encapsulate domain calculations (e.g., line item totals, taxes, discounts, aggregate counts, full names) directly inside the model, eliminating duplicated calculation logic across backend engines, API clients, and frontend forms.

## 2. Declaration Syntax

A computed field is declared by providing a `compute` expression on the field definition:

```json
"fields": {
  "subtotal": {
    "type": "decimal(12,2)",
    "compute": "sum(lines, qty * unitPrice)"
  },
  "taxAmount": {
    "type": "decimal(12,2)",
    "compute": "round(subtotal * taxRate, 2)"
  },
  "grandTotal": {
    "type": "decimal(12,2)",
    "compute": "subtotal + taxAmount - discountAmount"
  }
}
```

## 3. Dependency Graph and Cycle Detection

1. **Static Dependency Extraction:**
   - The compiler analyzes the AST of each `compute` expression to extract the set of referenced field identifiers.
   - A directed dependency graph of fields is constructed for each entity.
2. **Topological Evaluation Ordering:**
   - Computed fields are evaluated in topological order, ensuring that any prerequisite computed field (e.g., `subtotal`) is fully evaluated before a downstream computed field (e.g., `taxAmount`, `grandTotal`) reads its value.
3. **Cycle Rejection (`COMPUTED_CYCLE`):**
   - Cycles in computed fields (e.g. `fieldA` depends on `fieldB`, which depends on `fieldA`) represent impossible or non-terminating calculations.
   - Any dependency cycle causes compilation to fail with error code `COMPUTED_CYCLE`.

## 4. Pure Functional Semantics

All `compute` expressions must be **pure functions**:
- They depend solely on the entity's current field values, embedded entities, and ambient context (`ctx.now`).
- They cannot produce side effects, mutate other fields directly, or initiate external network I/O.
- For a given entity state, evaluation is deterministic and repeatable.

## 5. Execution Lifecycle and Persistence

1. **Read-Only Ingress:**
   - Computed fields cannot be set directly by external clients via create/update APIs or action `input`. Passing a value for a computed field is ignored or rejected.
2. **Recomputation Points:**
   - Evaluated during record instantiation (after defaults are applied).
   - Re-evaluated in step 6 of action execution (`run`), after all state mutation statements have executed on the working copy, immediately prior to validating rules and invariants.
3. **Persistence and Projections:**
   - Storage adapters (PostgreSQL, SQLite) may persist computed values as standard columns or virtual generated columns.
   - API projections (REST, GraphQL, MCP) serialize computed fields as normal readable properties.
