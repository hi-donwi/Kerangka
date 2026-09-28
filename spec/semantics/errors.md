# Kerangka Semantics: Error Taxonomy, RFC 9457 Format, and Diagnostics

- **Specification Version:** 0.1
- **Status:** Draft

## 1. Core Principles

Errors and diagnostics in Kerangka are first-class, machine-readable protocol artifacts:
1. **RFC 9457 Standard Compliance:** Runtime HTTP/API responses use `application/problem+json` format.
2. **Stable Error Codes:** Every failure carries a stable, machine-readable `code` from an authoritative taxonomy rather than relying on brittle string matching.
3. **Precise Locations:** Compiler and validation errors carry RFC 6901 JSON pointers (`path`) and source coordinates (`line`, `column`, `file`).
4. **Actionable Repair Hints:** Every diagnostic provides a clear `hint` that instructs developers and AI agents on the exact repair action.

## 2. Diagnostic Structure

```typescript
export interface Diagnostic {
  severity: "error" | "warning";
  code: string;
  message: string;
  path: string;           // RFC 6901 JSON Pointer (e.g. "/entities/Invoice/fields/amount")
  line?: number;          // 1-indexed source line
  column?: number;        // 1-indexed source column
  file?: string;          // File path within multi-context workspace
  hint?: string;          // Actionable resolution instructions
}
```

## 3. Authoritative Error Code Taxonomy

### 3.1 Schema and Compilation
| Error Code | Meaning |
|---|---|
| `SCHEMA_INVALID` | Document fails validation against the Kerangka JSON Schema |
| `UNSUPPORTED_VERSION` | Document requests an unsupported or deprecated Kerangka version |
| `PARSE_ERROR` | Syntax failure in JSON, YAML, or K1 expression parsing |
| `UNKNOWN_FIELD` | Reference to an undeclared field |
| `TYPE_MISMATCH` | Value or expression type does not match declared field type |
| `DUPLICATE_IDENTIFIER` | An identifier (context, entity, event, action) is declared more than once |
| `COMPUTED_CYCLE` | Circular dependency between computed fields |
| `EXPRESSION_TOO_DEEP` | Expression AST tree exceeds maximum depth (limit: 64) |
| `EXPRESSION_ERROR` | Expression violates AST node count limit or syntax rules |

### 3.2 Field and Record Validation
| Error Code | Meaning |
|---|---|
| `REQUIRED` | Non-nullable field is missing or null |
| `OUT_OF_RANGE` | Numeric or length constraint exceeded (`min`, `max`, `minLength`, `maxLength`) |
| `PATTERN_MISMATCH` | String does not match declared regular expression |
| `NOT_UNIQUE` | Field value violates a uniqueness constraint |
| `RULE_FAILED` | Custom entity business rule evaluated to `false` or `null` |
| `RULE_INDETERMINATE` | Rule could not be conclusively evaluated due to missing input |
| `DIVIDE_BY_ZERO` | Arithmetic division by zero in validation or guard context |
| `LIMIT_EXCEEDED` | Collection size exceeds maximum allowed capacity |

### 3.3 Actions, Workflows, and Permissions
| Error Code | Meaning |
|---|---|
| `UNKNOWN_ACTION` | Target action is not defined on the entity |
| `INPUT_INVALID` | Action payload does not satisfy input schema |
| `GUARD_FAILED` | Action `when` predicate evaluated to `false` or `null` |
| `INVALID_TRANSITION` | Current entity state cannot transition via the requested action |
| `FORBIDDEN` | Requesting actor lacks role or row-level permission for the operation |

### 3.4 Invariants
| Error Code | Meaning |
|---|---|
| `INVARIANT_VIOLATED` | Domain invariant evaluated to `false` or `null` after action execution |
| `INVARIANT_PROVABLY_VIOLATED` | Static analysis proved an action sequence inevitably violates an invariant |

### 3.5 Bounded Contexts, Modularity, and Linting
| Error Code | Meaning |
|---|---|
| `CONTEXT_NOT_FOUND` | Referenced context directory or definition does not exist |
| `DEPENDENCY_CYCLE` | Circular dependency between contexts (`dependsOn`) |
| `NOT_EXPORTED` | Policy or query attempts to use an unexported symbol from another context |
| `EXPORT_NOT_DEFINED` | Context exports a symbol that it does not declare |
| `CROSS_SERVICE_LOAD` | Synchronous `uses` load crosses service boundaries under `--topology` |
| `UNUSED_EXPORT` | Context exports a symbol that is not referenced across the workspace |

## 4. Deterministic Ordering

All diagnostic and validation error arrays are sorted deterministically:
1. Primary key: **RFC 6901 JSON pointer (`path`)** in ascending ASCII order.
2. Secondary key: **`code`** in alphabetical order.

This guarantees reproducible CI check outputs and consistent AI evaluation loops.
