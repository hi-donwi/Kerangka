# Canvas spike

This directory is the NX-02 spike that decided the Studio graph surface. The decision is
in [ADR-0051](../../docs/adr/0051-the-studio-graph-surface-uses-a-pinned-graph-library.md)
and the measurements are in [the canvas spike report](../../docs/studio/canvas-spike.md).

It is **not** part of the product. It is not a workspace package, it is not built by
`npm run build`, and the root test suite does not collect it. It has its own
dependencies and its own browser requirement, and it is kept so the comparison can be
repeated when the library version or the scale budget changes.

## What is here

| File | Purpose |
|---|---|
| `src/fixture.ts` | The controlled fixture: 250 nodes, 500 edges, a state machine with a legal cycle, and a containment tree where a cycle is a defect |
| `src/protocol.ts` | The measurement protocol, shared by both candidates, so the timing is the same clock for both |
| `src/flow.tsx` | Candidate A: the graph library, in controlled mode |
| `src/svg.tsx` | Candidate B: a hand-written SVG canvas |
| `run.mjs` | The driver: one production build per candidate, the same gestures, one clock |
| `probe.mjs` | A one-off inspection of the library's focus model |
| `result.json` | The recorded measurements |

## Running it

```sh
cd spike/canvas
npm install
PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=0 node run.mjs
```

The run prints the comparison and rewrites `result.json`.

## Rules for changing it

- The fixture, the gestures, and the protocol are the measurement. Changing one of them
  invalidates the comparison against the recorded numbers.
- A candidate may not time its own interactions. The driver owns the clock, because two
  libraries report the same gesture through different events.
- A measurement is not accepted until the method that produced it has been checked for
  faults. Two faults were found and fixed here; both are recorded in the report.
