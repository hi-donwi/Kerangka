# ADR-0004: Strict Numeric and Temporal Model

- **Date:** 2026-09-27
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

Floating point arithmetic causes disastrous rounding errors in business calculations (e.g. 0.1 + 0.2 != 0.3), and platform timezones cause non-deterministic behavior.

## Decision

We standardize on exact decimal arithmetic: integers are safe-range 64-bit; decimals are represented as strings up to 28 digits with HALF_EVEN rounding; all timestamps are ISO 8601 UTC instants; string operations are Unicode code-point based; regex follows RE2.

## Consequences

### Positive
- 100% deterministic arithmetic across TypeScript, JVM, Python, Dart, and Go; no monetary calculation discrepancies.

### Negative
- Requires engine-specific decimal wrapper libraries to normalize platform-specific BigDecimal/Decimal quirks.

### Neutral
- Decimals serialize as strings in JSON payloads to preserve precision across JSON parsers.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| IEEE 754 Floats everywhere | Unacceptable for billing, accounting, and inventory business software. |
| Arbitrary precision numbers without caps | Vulnerable to denial-of-service via unbounded decimal division. |

## Follow-up

- [x] Recorded in PLAN.md §22
- [ ] Conformance test cases written
- [ ] Tier 1 engine implementations verified
