# ADR-0020: Multiple API Projections with RFC 9457 Error Parity

- **Date:** 2026-09-27
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

Different consumers require different protocols (REST for webhooks, GraphQL for dashboards, MCP for AI agents, gRPC for internal microservices).

## Decision

All APIs are generated projections calling the exact same engine. REST is the default, returning RFC 9457 Problem Details (`application/problem+json`) with stable error codes. An `api-parity` conformance test class guarantees identical results across REST and GraphQL.

## Consequences

### Positive
- Zero duplicate business logic across protocols; first-class AI integration via generated MCP server.

### Negative
- Requires maintaining emitters for OpenAPI, GraphQL SDL, and MCP schemas.

### Neutral
- All protocols enforce the exact same row-level permissions and rate limits.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| REST only | Forces teams to hand-roll GraphQL or AI agent integrations outside the model. |

## Follow-up

- [x] Recorded in PLAN.md §22
- [ ] Conformance test cases written
- [ ] Tier 1 engine implementations verified
