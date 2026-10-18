# Kitchen Sink

Run synthetic repository samples through the actual TypeScript reference engine in a
fresh browser worker. No server-side execution, persisted state, connector dispatch,
model editing, or network connection is part of the production runner.

## Setup

From the repository root:

```bash
npm ci
npm run build
```

Then from `kitchen-sink/`:

```bash
npm ci
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm run dev` also requires the root build. Both dev and build regenerate sample KIR
and other projections under `generated/<id>/`; generated output remains gitignored.
Rebuild the root workspace after changing the compiler or engine.

## Execution Boundary

Each manifest input declares `run: "Entity.operation"`, `record`, optional operation
`input`, and optional `actor`. Expected outcomes can name an exact engine `error` code
as well as expected record fields. The UI shows actual output, PASS/MISMATCH, and engine
time. Reset and navigation cancel pending work; every run starts from the fixture.

Limits: 16 KiB input metadata, 256 KiB KIR, 16 entities, 128 declared operations,
20,000 structural nodes, depth 32, one operation and a 1000 ms worker deadline, and an
8 KiB output preview. Comparisons happen before truncation. Errors, unsupported targets,
missing artifacts, and deadlines show source with a reason rather than a fake result.
See [ADR-0048](../docs/adr/0048-browser-samples-run-in-disposable-workers.md).

Production CSP blocks connections in the page and inherited blob-worker context.
Effects are inspectable data, never delivered, and no storage adapter is imported.
Vite's development server uses HMR and is not this production boundary. This runner
accepts only shipped fixtures; it is not a security sandbox for arbitrary code or models.

`uidl-runtime` is retained by decision. Rendering UIDL documents is a separate slice and
is not represented as complete by these engine runs. C2 owner acceptance and C3
publication are still separate gates.
