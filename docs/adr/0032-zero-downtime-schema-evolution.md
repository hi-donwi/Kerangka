# ADR-0032: Zero-Downtime Schema Evolution via Expand/Contract

- **Date:** 2026-09-27
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

In distributed microservices and rolling deployments, old and new application nodes run simultaneously. Breaking changes in models or migrations cause service crashes during deployment.

## Decision

We enforce the Expand/Contract pattern across models, migrations, and CloudEvents. New fields must be introduced as optional (Expand) before becoming required in subsequent versions (Contract). The `kerangka diff --check-breaking` command acts as an automated CI gate.

## Consequences

### Positive
- Zero-downtime rolling upgrades across production clusters; prevents distributed deployment outages.

### Negative
- Requires two deployment phases to execute destructive schema changes.

### Neutral
- Major version bumps allow breaking changes when explicitly declared.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| In-place destructive database migrations | Forces application downtime during every schema modification. |

## Follow-up

- [x] Recorded in PLAN.md §22
- [ ] Conformance test cases written
- [ ] Tier 1 engine implementations verified
