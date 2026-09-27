# ADR-0016: Declarative Allowlisted Connectors

- **Date:** 2026-09-27
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

Common I/O tasks like calling external REST APIs or sending notifications often force developers to write custom host code, breaking portability.

## Decision

We provide declarative connectors (`http`, `sequence`, `email`, `webhook`, `files`) configured entirely in JSON. Hosts allowlist external domains, private IP ranges are blocked by default, and secrets are referenced, never hardcoded.

## Consequences

### Positive
- Most standard business integrations require zero host code; built-in SSRF protection.

### Negative
- Connectors are limited to standardized protocols; highly proprietary legacy protocols still require host extensions.

### Neutral
- Read connectors execute before `run` via `uses`; write connectors execute as post-commit `call` effects.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Host code extensions for all I/O | Destroys 'JSON is enough' promise and fragments cross-platform portability. |

## Follow-up

- [x] Recorded in PLAN.md §22
- [ ] Conformance test cases written
- [ ] Tier 1 engine implementations verified
