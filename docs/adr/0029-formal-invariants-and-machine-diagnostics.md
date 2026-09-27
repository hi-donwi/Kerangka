# ADR-0029: Formal Invariants and Machine-Readable Diagnostics for AI Self-Healing

- **Date:** 2026-09-27
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

Action guards protect single transitions, but cannot guarantee multi-state integrity. AI agents need machine-readable compiler feedback to automatically fix invalid models without human intervention.

## Decision

Aggregates can declare `invariants` that are statically verified by `kerangka verify` and asserted before every state commit (triggering automatic rollback on violation). Compiler diagnostics support `--format=json` (LSP format) with precise repair clues.

## Consequences

### Positive
- Ironclad aggregate integrity; enables automated closed-loop self-repair for AI coding agents.

### Negative
- Slight runtime overhead evaluating invariants on aggregate commits.

### Neutral
- Invariants complement, but do not replace, action transition guards.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Action guards only with untyped error strings | Leaves aggregates vulnerable to inconsistent multi-step states and renders automated AI self-repair unreliable. |

## Follow-up

- [x] Recorded in PLAN.md §22
- [ ] Conformance test cases written
- [ ] Tier 1 engine implementations verified
