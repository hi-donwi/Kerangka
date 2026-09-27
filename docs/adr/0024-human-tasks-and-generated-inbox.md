# ADR-0024: Human Tasks on Workflows with Generated Inbox

- **Date:** 2026-09-27
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

Almost all business applications require human reviews, multi-stage approvals, and assignment queues.

## Decision

Workflow states can declare human `tasks` with role/assignment rules, actions, and due SLAs. The system automatically generates an `inbox` query, 'My Tasks' UIDL views, and timer-driven SLA escalations.

## Consequences

### Positive
- Solves the biggest functional gap in business CRUD tools without needing an external BPM engine.

### Negative
- Requires task assignment metadata tracking in the persistence store.

### Neutral
- Assignment is advisory for the inbox; action permissions still enforce who may commit transitions.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Embedding an external BPMN engine (Camunda/Flowable) | Huge runtime dependency that violates single-binary / single-database simplicity. |

## Follow-up

- [x] Recorded in PLAN.md §22
- [ ] Conformance test cases written
- [ ] Tier 1 engine implementations verified
