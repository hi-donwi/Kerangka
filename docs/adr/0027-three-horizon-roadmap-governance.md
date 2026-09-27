# ADR-0027: Three-Horizon Roadmap Governance

- **Date:** 2026-09-27
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

Ambitious visions easily lead to feature creep, delaying initial release indefinitely and killing project momentum.

## Decision

We partition the roadmap into three strict horizons: Horizon 1 (v1.0, ~10 months, scope frozen); Horizon 2 (v1.x, ecosystem, adapters, reach via public RFCs); Horizon 3 (v2.0, studio, neutral foundation). Horizon 1 scope cannot be expanded without dropping an equivalent item.

## Consequences

### Positive
- Ensures v1.0 actually ships; provides a transparent path for community contributions in Horizon 2.

### Negative
- Requires discipline to defer exciting features to Horizon 2.

### Neutral
- All IR-shaping semantics are locked in Horizon 1 to prevent breaking changes.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Single monolithic roadmap | Guarantees scope explosion and indefinite delay. |

## Follow-up

- [x] Recorded in PLAN.md §22
- [ ] Conformance test cases written
- [ ] Tier 1 engine implementations verified
