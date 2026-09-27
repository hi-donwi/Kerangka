# ADR-0025: Privacy and Compliance by Model

- **Date:** 2026-09-27
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

Regulations like Indonesia UU PDP and EU GDPR mandate strict personal data protection, auditability, and data subject rights.

## Decision

Fields can be marked `personal` or `sensitive`. The runtime automatically masks personal fields in logs and traces, records state changes in an append-only audit trail, and prepares models for automated export and erasure.

## Consequences

### Positive
- Compliance built into the architecture from day one; prevents accidental privacy breaches in application telemetry.

### Negative
- Requires masking logic across all logger and tracer adapters.

### Neutral
- Compliance mechanisms are provided by Kerangka; legal accountability remains with the operator.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Leaving privacy masking to custom host logging code | Guaranteed to leak personal data in traces and log files. |

## Follow-up

- [x] Recorded in PLAN.md §22
- [ ] Conformance test cases written
- [ ] Tier 1 engine implementations verified
