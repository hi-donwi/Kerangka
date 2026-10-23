# ADR-0050: A Journey Is a Reference Index, Not a Second Program

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

Kerangka Studio is becoming a visual authoring host (ADR-0049). The owner asked for an
n8n-like design surface that covers UIDL pages, application journeys, and Kerangka models.
A journey in that surface connects pages, user intents, business operations, and outcomes.

The risk is a second program. Kerangka already owns business outcomes, and UIDL already
owns presentation behavior. A journey format that carried its own actions, guards, roles,
or effects would compete with both: two definitions of one behavior, two places to change
it, and a graph whose edges would have to become an execution model to mean anything.

The studio source bundle already sets the pattern that answers this. It is an authoring
envelope that references existing sources, keeps author text authoritative, and refuses to
reconstruct sources from compiled output. A journey has to obey the same rule, or the
visual layer becomes a second source of truth.

## Decision

A journey is a **reference index**. It names steps and links, and it owns no behavior.

| Journey element | Meaning | Owner of the behavior |
|---|---|---|
| `page` step | An existing page in the application manifest | The authored UIDL source, or the recipe that generates it |
| `operation` step | An existing `Entity.action` or `Entity.transition` | The Kerangka model, the compiler, and the engine |
| `action` link | An event action in the source page's UIDL document, addressed by pointer | The UIDL document and the UIDL runtime interpreter |
| `navigation` link | A navigation target between pages | The UIDL `navigate` action and the host route contract |
| `annotation` link | An author's note | Nothing; it is not executed |

Consequences of that decision, all enforced in code:

1. A journey document accepts no action, guard, role, credential, or effect. Unknown
   fields are refused rather than ignored, so a journey cannot quietly grow behavior.
2. `mode` is `reference` only. There is no executable journey mode, and an executable one
   would need its own specification, runtime, and conformance suite.
3. A pointer addresses the live node tree of a page document: `root`, then
   `children/<index>`, `slots/<name>/<index>`, or `events/<name>/<index>`. It ends at an
   event action. It cannot walk into a reusable definition, and it cannot walk inside an
   action, because a link points at something a person triggers.
4. One action leads to one target. Two links claiming the same action for different
   targets are a conflict, and so is one operation claimed by two journeys.
5. A page without an authored document has no stable tree. A recipe page is generated per
   request, so a link to one is refused rather than resolved against a document that
   changes.

The structural contract is `spec/studio/journey.schema.json`; the semantic gates are in
`packages/studio-server/src/journey.ts`. The two are checked against one corpus so the
schema and the runtime cannot drift apart.

## Alternatives

| Alternative | Reason not selected |
|---|---|
| A journey carries its own actions and guards | Creates a second program and a second source of truth for behavior Kerangka and UIDL already own |
| A journey is only a diagram with no persisted form | A diagram cannot be reviewed, diffed, or exported; it also cannot be checked for conflicting claims |
| Reuse the source-bundle envelope for journeys | The bundle owns page ownership and routes; a journey has different elements and needs its own versioned contract |
| Allow pointers into reusable definitions | A definition is a template instantiated in several places, so one pointer would not name one place |
| Keep journey semantics in the browser only | The checks would not run for CLI, export, or a second host, and the two copies would drift |
| Make the journey executable now | Fork/join, durable waits, and compensation need their own specification, runtime, and cross-engine conformance |

## Consequences

### Positive

- The visual surface can never disagree with the compiled model or the runtime document.
- A journey is reviewable as a diff, and an export carries no hidden behavior.
- The existing UIDL and Kerangka contracts stay authoritative, so the visual layer adds no
  runtime dependency to the engine or the compiler.

### Negative

- A journey cannot express a connection that no existing action realizes. That connection
  has to be authored as a UIDL action first, and the journey then points at it.
- Cross-journey conflict detection needs every journey at once, so it is a separate check
  rather than a per-document guarantee.

### Neutral

- The UIDL runtime is unchanged. The Kerangka model is unchanged. The compiler is unchanged.
- This ADR adds no package dependency and no runtime capability.

## Follow-up

- The canvas that draws these links, the editor that creates them, and the source
  persistence that stores them are separate work with their own acceptance gates.
- If an executable journey is ever proposed, it needs an RFC, a runtime, conformance
  cases, and a new ADR superseding this one.
