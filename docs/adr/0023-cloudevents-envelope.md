# ADR-0023: CloudEvents Envelope for Domain Events

- **Date:** 2026-09-27
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

Custom event formats create friction when integrating with modern enterprise brokers, serverless platforms, and cloud streaming architectures.

## Decision

All domain events emitted by Kerangka aggregates are packaged in the CloudEvents envelope (CNCF standard), carrying event ID, source, type, timestamp, and schema version metadata.

## Consequences

### Positive
- Direct interoperability with Kafka, NATS, AWS EventBridge, Google Cloud Eventarc, and Knative without envelope translation.

### Negative
- Adds minor metadata envelope overhead to event payloads.

### Neutral
- Event payloads adhere to JSON Schema defined in the context exports.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Proprietary Kerangka event wrapper | Forces every enterprise consumer to write custom event adapters. |

## Follow-up

- [x] Recorded in PLAN.md §22
- [ ] Conformance test cases written
- [ ] Tier 1 engine implementations verified
