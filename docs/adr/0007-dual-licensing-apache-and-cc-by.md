# ADR-0007: Dual Licensing: Apache-2.0 and CC BY 4.0

- **Date:** 2026-09-27
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

Kerangka aims to be an open standard. Enterprise adopters require an explicit patent grant, while implementers need the freedom to translate, study, and republish the specification.

## Decision

We license all code, compilers, CLI tools, and runtime engines under Apache-2.0. We license all specification text and formal documentation under Creative Commons Attribution 4.0 International (CC BY 4.0).

## Consequences

### Positive
- Explicit patent grant encourages enterprise adoption; CC BY ensures the specification can never be locked down by a single vendor.

### Negative
- Slightly more complex licensing documentation than a single MIT license.

### Neutral
- Both licenses are permissive and compatible with commercial closed-source software built using Kerangka.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| MIT license for everything | Lacks an explicit patent grant, which causes hesitation for enterprise legal review. |
| GPL / AGPL | Viral license prevents commercial embedding of Kerangka engines into proprietary host applications. |

## Follow-up

- [x] Recorded in PLAN.md §22
- [ ] Conformance test cases written
- [ ] Tier 1 engine implementations verified
