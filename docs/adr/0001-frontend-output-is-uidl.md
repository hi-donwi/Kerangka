# ADR-0001: Frontend Output is UIDL

- **Date:** 2026-09-27
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

Kerangka needs a portable, declarative UI representation to generate user-facing surfaces across web and mobile without inventing a second UI description language from scratch.

## Decision

We adopt UIDL (UI Document Language) from the sibling repository `hi-donwi/UIDL-Runtime` as Kerangka's canonical frontend output. Kerangka compiles its `views` declarations into validated UIDL documents, leaving UI rendering and component state management entirely to UIDL runtimes.

## Consequences

### Positive
- Reuses existing UIDL runtimes (React, Flutter, Android) and its rich ecosystem; clean architectural separation between business logic and presentation.

### Negative
- Kerangka's UI capabilities are bounded by what UIDL can express, requiring co-evolution when new UI primitives are needed.

### Neutral
- Kerangka views compile to UIDL JSON documents instead of HTML, JSX, or native widgets.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Own UI schema | Creating a new UI DSL increases concept surface and duplicates the existing UIDL investment. |
| JSON Forms / react-jsonschema-form | Tied tightly to schema-only forms; lacks support for custom views, navigation shells, dashboards, and multi-platform Flutter/Android rendering. |

## Follow-up

- [x] Recorded in PLAN.md §22
- [ ] Conformance test cases written
- [ ] Tier 1 engine implementations verified
