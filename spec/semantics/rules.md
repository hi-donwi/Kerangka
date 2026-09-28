# Kerangka Semantics: Rules, Field Constraints, and Fail-Closed Validation

- **Specification Version:** 0.1
- **Status:** Draft

## 1. Overview

Kerangka validates data integrity at two distinct layers:
1. **Field Constraints:** Declarative constraints directly attached to individual field types (`required`, `min`, `max`, `minLength`, `maxLength`, `pattern`, `scale`, `unique`).
2. **Entity Rules:** Cross-field business assertions declared under the entity's `rules` block that express invariants and domain validity.

Validation is idempotent, side-effect free, and deterministic across all platform implementations.

## 2. Declaration Syntax

### 2.1 Field Constraints
Attached directly to field declarations or in shorthand syntax:
```json
"fields": {
  "age": "int! >= 18 <= 120",
  "username": { "type": "string", "minLength": 3, "maxLength": 30, "pattern": "^[a-z0-9_-]+$" },
  "discountRate": "decimal(5,4)! >= 0 <= 1.0000"
}
```

### 2.2 Entity Business Rules
Declared under the entity's `rules` list:
```json
"rules": [
  {
    "id": "discount_requires_approval_above_limit",
    "when": "discountRate > 0.20",
    "assert": "approvedBy != null",
    "message": "Discounts exceeding 20% require manager approval"
  },
  {
    "id": "end_after_start",
    "assert": "endDate >= startDate",
    "message": "End date must be on or after start date"
  }
]
```

#### Rule Specification
- `id`: Stable kebab-case or snake_case identifier.
- `assert`: K1 boolean expression that must evaluate to `true`.
- `when` (optional): Predicate determining when this rule applies. If `when` evaluates to `false` or `null`, the rule is skipped.
- `message`: User-facing localized validation error description.

## 3. The Fail-Closed Principle

In UI display logic, expression errors or missing fields may gracefully return `null`. In domain validation, rules, action guards, and authorization checks, this is strictly forbidden.

> **Fail-Closed Rule:**
> A rule assertion, action guard (`when`), or permission condition passes **only when it evaluates to exactly the boolean value `true`**.

- If an expression evaluates to `false`, it fails with `RULE_FAILED` or `GUARD_FAILED`.
- If an expression evaluates to `null` (e.g. division by zero, null propagation), it fails with `RULE_FAILED` (or `RULE_INDETERMINATE`).
- If an expression fails due to an evaluation error (e.g. out of bounds), it fails closed.

## 4. Multi-Error Collection and Deterministic Ordering

Engines must **never stop at the first error**. Validation collects all failing field constraints and business rules for the target record:
1. **Field Constraints First:** Requiredness, type matching, bounds, patterns, and scales.
2. **Entity Rules Second:** All applicable rules whose `when` condition holds.

### Deterministic Sorting
To guarantee repeatable diagnostics, snapshots, and tests:
- Errors are sorted primarily by **RFC 6901 JSON pointer** (`/fields/email`, `/rules/0/assert`).
- Ties are broken by **error code** in alphabetical order (`OUT_OF_RANGE` before `PATTERN_MISMATCH`).
