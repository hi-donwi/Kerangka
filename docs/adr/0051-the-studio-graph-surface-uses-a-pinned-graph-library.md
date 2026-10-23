# ADR-0051: The Studio Graph Surface Uses a Pinned Graph Library, Loaded on Demand

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

Studio needs a canvas in three places: the journey composer, the workflow state view, and
the entity relationship view. ADR-0049 named `@xyflow/react@12.12.0` as a candidate and
required a spike before adoption, with a fallback if the spike failed.

The candidate under comparison was a canvas written by hand in React and SVG. Two
claims were on the table: that a hand-written canvas avoids a dependency, and that a
graph library costs more than it saves.

NX-02 measured both against the same fixture, the same gestures, and one clock. The
results are in [the canvas spike report](../studio/canvas-spike.md).

At the scale budget of 250 visible nodes and 500 edges, the two are indistinguishable:
select 19.3 ms against 17.5 ms, drag 29.5 ms against 31.1 ms, zoom 33.3 ms against
33.2 ms, pan 29.8 ms against 31.8 ms, and both hold 60 fps during a drag. The library
costs about 58 KB gzip more.

The measurable difference is not speed. The library ships the affordance the journey
composer depends on: connection handles a pointer can grab (50 in the measured build),
edge reconnection, a minimap, viewport controls, and viewport culling. The hand-written
canvas had none of them, and every one of them would have to be built, tested, and
maintained here, in a repository whose subject is business semantics rather than graph
interaction.

## Decision

Studio's graph surfaces use `@xyflow/react`, pinned to an exact version, in controlled
mode, and loaded on demand.

| Property | Rule |
|---|---|
| Version | Pinned exactly. A minor bump is a deliberate change with a re-run of the spike, not a floating range |
| Mode | Controlled. The host owns the node and edge state, so the canvas cannot become a second copy of the document |
| Loading | The graph chunk is fetched when a graph is opened. The engine, the compiler, and a normal application page never load it |
| Scope | Studio only. The library is not a dependency of `@kerangka/compiler`, `@kerangka/engine-ts`, or any runtime package |
| Legality | The host decides. A legal backward transition in a state machine is accepted, and a cycle in a containment tree is refused, by Studio's own rules and not by the canvas |
| Accessibility | Every graph action keeps a keyboard and table equivalent, because a canvas is not the only way to reach a node |
| Fallback | The hand-written SVG canvas remains the documented fallback, and the spike harness stays in the repository |

The version is MIT licensed, depends on `zustand`, `classcat`, and `@xyflow/system`,
reaches no network, and evaluates no downloaded code. Its peer range allows the React
version Studio already uses.

## Alternatives

| Alternative | Reason not selected |
|---|---|
| A hand-written SVG canvas | Equally fast, but every link affordance, reconnection, minimap, and culling would be built and maintained here, and none of that is the subject of this repository |
| A different graph library | Not evaluated. The candidate in ADR-0049 was measured and passed; a second library would be a second spike |
| Floating the version | A minor bump can change the controlled-state contract or the bundle cost silently, and the point of the spike is that the choice is evidence-based |
| Loading the graph library in the engine or compiler | The engine and compiler have no user interface. A rendering dependency there would reach every consumer of the standard for no reason |
| Replacing Studio's tree and table editors with the canvas | A canvas is not an accessible default. The existing table and tree views stay, and the canvas is the spatial view beside them |
| Waiting for a design before choosing | The canvas choice does not depend on the visual design of a node, and deferring it would delay every graph surface by a phase |

## Consequences

### Positive

- Link drawing, reconnection, minimap, and culling arrive with a maintained library
  rather than as work in this repository.
- The performance budget is met with evidence, and the evidence is repeatable.
- The dependency is invisible to the standard's consumers: it is fetched only when a
  designer opens a graph.

### Negative

- One more third-party dependency enters the Studio application, and it must be kept
  current deliberately.
- A jump in the major version can change the controlled-state contract, and that is a
  breaking change for Studio's graph surfaces.
- The bundle cost of the designer is about 58 KB gzip more than a hand-written canvas.

### Neutral

- The Kerangka model, the compiler, the engine, the UIDL runtime, and the UIDL
  document format are unchanged.
- The journey contract from ADR-0050 is unchanged. A canvas draws references; it does
  not define behavior.

## Follow-up

- Re-run the spike before any version change, and keep `spike/canvas/result.json` with
  the evidence.
- Give the graph surfaces the Studio node design, then measure again: the measured
  numbers are for default node rendering.
- Keep the tree and table views working for every graph, and prove it in the
  accessibility pass.
