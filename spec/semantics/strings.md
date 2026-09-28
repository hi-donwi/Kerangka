# Kerangka Semantics: Strings, Text, and Pattern Matching

- **Specification Version:** 0.1
- **Status:** Draft

## 1. Unicode Semantics and Code Point Alignment

Text representation must produce identical string length, substring offsets, and comparisons regardless of runtime environment (Node.js, JVM, Go, Python, or Dart):

1. **Code Point Length:**
   - The `len(s)` operator and `minLength` / `maxLength` field constraints count **Unicode code points (scalar values)**, NOT UTF-16 code units (as in JavaScript or Java) or UTF-8 byte lengths.
   - For example, a single astral emoji (e.g., `🚀` U+1F680) has code point length `1`.
2. **Deterministic Comparison:**
   - Relational comparisons (`<`, `<=`, `>`, `>=`) compare strings by their Unicode code point values in lexicographic order.
   - Comparisons are strictly **locale-independent** to prevent collation differences across operating system locales.
3. **Case Mapping:**
   - `lower(s)` and `upper(s)` apply the Unicode Standard default case mappings without locale tailoring.

## 2. String Manipulation Functions

| Function / Operator | Signature | Description | Null Semantics |
|---|---|---|---|
| `concat(a, b, ...)` | `(string...) -> string` | Concatenates string representations | Returns `null` if any argument is `null` (use `coalesce` to replace) |
| `lower(s)` | `(string) -> string` | Converts to lowercase using Unicode default mapping | Returns `null` if `s` is `null` |
| `upper(s)` | `(string) -> string` | Converts to uppercase using Unicode default mapping | Returns `null` if `s` is `null` |
| `trim(s)` | `(string) -> string` | Strips leading and trailing Unicode whitespace | Returns `null` if `s` is `null` |
| `len(s)` | `(string) -> int` | Number of Unicode code points | Returns `null` if `s` is `null` |
| `contains(s, sub)` | `(string, string) -> bool` | Checks if `sub` is a substring of `s` | Returns `false` if `s` or `sub` is `null` |
| `startsWith(s, prefix)` | `(string, string) -> bool` | Checks if `s` begins with `prefix` | Returns `false` if `s` or `prefix` is `null` |
| `matches(s, pattern)` | `(string, string) -> bool` | Matches against an RE2-compatible regular expression | Returns `false` if `s` is `null` |

## 3. Regular Expressions (RE2 Subset)

To eliminate Regular Expression Denial of Service (ReDoS) vulnerabilities and guarantee linear-time execution, Kerangka restricts regular expression patterns to an **RE2-compatible subset**:

- **Prohibited Constructs:**
  - Backreferences (`\1`, `\k<name>`)
  - Lookaround assertions (positive/negative lookahead `(?=...)`, `(?!...)` and lookbehind `(?<=...)`, `(?<!...)`)
- **Supported Constructs:**
  - Character classes (`[a-z0-9]`, `[^0-9]`, `\d`, `\w`, `\s`)
  - Quantifiers (`*`, `+`, `?`, `{n}`, `{n,m}`, non-greedy `*?`, `+?`)
  - Alternation (`a|b`)
  - Grouping and non-capturing groups (`(...)`, `(?:...)`)
  - Anchors (`^`, `$`)

Patterns are validated at compile time. Any authoring pattern containing prohibited constructs is rejected with error code `INVALID_PATTERN`.

## 4. Canonical JSON (RFC 8785)

For deterministic hashing, snapshot testing, outbox deduplication, and conformance assertions, JSON documents and entity states must be serialized according to **Canonical JSON (RFC 8785 / JCS)**:
1. Object keys are sorted lexicographically by Unicode code point order.
2. No unnecessary whitespace is emitted between tokens.
3. String escaping conforms strictly to RFC 8785.
4. Numbers follow the exact canonical representation specified in Kerangka Semantics: Numbers.
