# ADR-0005: Pure Engines with I/O as Effects

- **Date:** 2026-09-27
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

Embedding database calls or HTTP requests directly inside domain logic creates side effects, prevents deterministic testing, and makes offline replay impossible.

## Decision

All Kerangka engines are strictly pure libraries without internal I/O, network, or clock state. The host application injects context (actor, timestamp, external data via `uses`), and the engine returns a new state and a list of declarative `effects` (`persist`, `emit`, `call`).

## Consequences

### Positive
- Engines are trivially testable with data fixtures; identical execution in web workers, mobile offline clients, and cloud microservices.

### Negative
- Host applications must provide an outer runtime loop or adapter to execute returned effects.

### Neutral
- Sidecar `kerangka serve` provides an out-of-the-box effect runner for hosts that do not embed the engine natively.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Engines calling database/repositories directly | Destroys engine portability, breaks client-side offline execution, and causes race conditions. |

## Follow-up

- [x] Recorded in PLAN.md §22
- [ ] Conformance test cases written
- [ ] Tier 1 engine implementations verified
