# Canvas Spike: Graph Library Against a Native SVG Canvas

Status: Measured on 2026-10-21 for NX-02 of the visual authoring roadmap. The decision it
supports is recorded in [ADR-0051](../adr/0051-the-studio-graph-surface-uses-a-pinned-graph-library.md).
This document is the evidence; the ADR is the decision.

## Question

Studio needs a canvas for the journey composer, the workflow state view, and the entity
relationship view. The two candidates were a graph library and a canvas written by hand.
ADR-0049 named `@xyflow/react@12.12.0` as a candidate, not a decision, and required a
spike before adoption.

## Method

Both candidates are the same program with a different canvas:

| Property | How it was held constant |
|---|---|
| Fixture | The same 250 nodes and 500 edges, generated from a fixed seed |
| Legality | The same two graphs: a state machine with a legal backward transition, and a containment tree where a cycle is a defect |
| Viewport | The same origin and the same 0.6 zoom, so the visible set is comparable |
| Gestures | The same 30 selections, 30 drags, 20 zooms, and 20 pans, in the same order |
| Timing | One clock, in the driver: from the page's record of the last input event to the frame after the change is committed |
| Build | One production build per candidate, measured separately, so no shared chunk is attributed to either |

The harness is in [`spike/canvas`](../../../spike/canvas). It is not a workspace package,
it is not part of the product build, and it installs its own dependencies.

Two measurement faults were found and fixed before the numbers were accepted, and both
are worth recording because either would have produced a confident wrong answer:

1. Timing inside each candidate compared two different event APIs. One library reports a
   drag on press, the other reports it on release, and a click is a drag to one of them.
   The driver now owns the clock.
2. The interval measured from the driver's wall clock included the automation channel's
   own latency, which was larger than the effect being measured. The interval now starts
   at the page's record of the last input event. The frame pacing sampled during the
   gesture covers the work in between.

## Results

Machine: Apple Silicon, Node 22, Chromium 156 headless, 1440x1000. Thirty samples per
interaction kind, twenty per zoom and pan.

| Measurement | Graph library | Native SVG | Reading |
|---|---|---|---|
| Production bundle, gzip | 128,456 B | 70,202 B | The library adds about 58 KB gzip to a React app |
| Select, p50 / p95 | 19.3 / 21.2 ms | 17.5 / 32.7 ms | A tie within noise |
| Drag, p50 / p95 | 29.5 / 30.3 ms | 31.1 / 31.6 ms | A tie |
| Zoom, p50 / p95 | 33.3 / 33.4 ms | 33.2 / 33.3 ms | A tie |
| Pan, p50 / p95 | 29.8 / 30.6 ms | 31.8 / 31.9 ms | A tie |
| Frame pacing during a drag, p50 / p95 | 16.6 / 17.3 ms | 16.6 / 16.9 ms | Both hold 60 fps |
| Keyboard: focus a node, press an arrow key | moves 8 px | moves 8 px | Both work |
| Connection handles a pointer can grab | 50 | 0 | The library ships the affordance |
| Node elements in the document | 100 (virtualized) | 250 | The library culls; the hand-written canvas does not |
| Edge elements in the document | culled with the viewport | 500 | Same |
| Legal backward transition | accepted | accepted | Neither refuses a legal model |
| Containment cycle | refused | refused | Both can refuse an illegal one |

**Interaction performance is a tie at the scale budget.** Nothing in the measurements
favours either candidate, and the earlier "SVG is faster" claim does not survive a
measurement that excludes the harness.

## What the numbers do not say

- The hand-written canvas has no virtualization, no minimap, no edge reconnection, no
  link dragging with a live preview, no marquee selection, and no touch handling. Its
  numbers are therefore the cost of the simplest canvas that can do the four measured
  gestures, and the cost of the features a journey composer actually needs is not in
  this document.
- The library's numbers are for its default node and edge rendering, not a Studio
  design. A Studio node carries status, an action label, and a source pointer.
- One build, one machine, one browser. The figures are indicative and reproducible, not
  a certified performance guarantee.
- The measured interactions are on the visible part of the graph. Both candidates would
  need re-measuring against a graph with 2,000 nodes, which is outside the current
  budget of 250 visible nodes and 500 edges.

## Decision

The graph library is adopted for the Studio graph surfaces, pinned, in controlled mode,
and loaded on demand. The evidence is not that it is faster; it is that it is equally
fast, it supplies the affordance the journey composer depends on, and it costs about
58 KB gzip in a chunk that is only fetched when a graph is opened.

The native canvas is not thrown away. It remains the documented fallback, and the spike
harness stays in the repository so the comparison can be repeated when the library
changes or the budget moves.

## Reproducing

```sh
cd spike/canvas
npm install
PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=0 node run.mjs
```

The run writes `spike/canvas/result.json` and prints the table above.
