# Kerangka Semantics: Types and Validation

- **Specification Version:** 0.1
- **Status:** Draft

## 1. Type System Overview

Kerangka uses a nominal, statically checked type system. Types are declared in authoring documents and fully resolved in the compiled Intermediate Representation (IR).

Every field declaration specifies a base type and nullability:
- Non-nullable fields end with an exclamation mark: `string!`
- Nullable / optional fields omit the exclamation mark: `string`

## 2. Primitive Types

| Type | Description | Wire Representation | Constraints |
|---|---|---|---|
| `string` | Unicode character sequence | JSON String | `minLength`, `maxLength`, `pattern` (RE2) |
| `int` | Signed 64-bit integer | JSON Number / String | `min`, `max` |
| `decimal(p,s)` | Exact fixed-point decimal (≤ 28 digits) | JSON String | `min`, `max`, `scale`, `precision` |
| `bool` | Boolean value (`true` or `false`) | JSON Boolean | None |
| `date` | ISO 8601 calendar date (`YYYY-MM-DD`) | JSON String | `min`, `max` |
| `instant` | ISO 8601 UTC timestamp (`YYYY-MM-DDTHH:MM:SSZ`) | JSON String | `min`, `max` |
| `uuid` | RFC 4122 UUID (v4 or v7) | JSON String | Canonical lowercase 8-4-4-4-12 |
| `email` | RFC 5322 Email address | JSON String | Format validation |

## 3. Composite and Complex Types

### 3.1 Enumerations (`enum`)
A closed list of string literals.
```json
"status": { "type": "enum", "values": ["draft", "submitted", "approved", "rejected"] }
```

### 3.2 Value Objects (`types`)
Reusable value structures defined under top-level `types`:
```json
"types": {
  "Money": {
    "fields": {
      "amount": "decimal(18,4)!",
      "currency": "string(3)!"
    }
  }
}
```

### 3.3 Embedded Entities (`embedded`)
Entities that have no independent identity or lifecycle and live completely inside their aggregate root.
Embedded entities hydrate and persist atomically with the parent aggregate.

### 3.4 Collections (`list<T>`)
Ordered sequence of items. Bounded in memory to prevent exhaustion attacks. Default maximum size is 1,000 items unless explicitly configured.
