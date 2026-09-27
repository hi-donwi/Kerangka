# ADR-0015: Time as an Input: Declarative Schedules and Timers

- **Date:** 2026-09-27
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

Allowing engines to query the system clock directly destroys determinism, prevents replay testing, and makes simulated time travel impossible.

## Decision

Time is strictly an input: `ctx.now` is supplied by the host. Recurring actions (`schedules` with cron) and delayed workflow transitions (`timers`) are declared in the model and triggered externally by the scheduler port.

## Consequences

### Positive
- 100% deterministic time execution; testing multi-day workflows takes milliseconds by passing future timestamps.

### Negative
- Host application must run a scheduler adapter (e.g. database-backed timer table or external runner).

### Neutral
- Engines never sleep, block, or manage background threads.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Engines managing background cron threads internally | Violates pure engine design and causes resource leaks in serverless/embedded environments. |

## Follow-up

- [x] Recorded in PLAN.md §22
- [ ] Conformance test cases written
- [ ] Tier 1 engine implementations verified
