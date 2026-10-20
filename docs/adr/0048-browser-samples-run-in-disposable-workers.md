# ADR-0048: Browser Samples Run in Disposable Workers

- **Date:** 2026-10-18
- **Status:** Accepted
- **Deciders:** Project maintainers

## Context

The kitchen sink must run real synthetic examples, not present expected results as
execution. The reference engine is pure; the compiler imports Node filesystem/path APIs.
Calling a synchronous engine on the UI thread cannot enforce a deadline with a timer.
Public static hosting must not introduce a writable host or a connector dispatcher.

## Decision

Compile sample models to KIR in Node during build and embed the generated JSON. Execute
one manifest-declared `Entity.operation` in a fresh, disposable Web Worker using the
same checkout's `@kerangka/engine-ts`. Compare actual outcomes, optional error codes,
and expected record fields before truncating output. Use a fixed sample clock
(`2026-10-01T00:00:00.000Z`) and never write the returned record to storage.

Enforce the following limits before posting to the worker and again inside it:

| Resource | Limit |
|---|---|
| Sample metadata, records, actors, and expectations | 16 KiB UTF-8 JSON |
| Compiled KIR | 256 KiB UTF-8 JSON |
| Entities / declared actions and transitions | 16 / 128 |
| Combined structural nodes / nesting depth | 20,000 / 32 |
| Runs per worker | One |
| Worker lifetime, including startup and result serialization | 1000 ms |
| Returned output preview | 8 KiB UTF-8 |

The UI terminates the worker on completion, failure, timeout, reset, or sample navigation.
Unavailable/unsupported execution shows model source with a reason. A timeout is a
refusal, not an expected business denial. Effects remain returned data and are never
dispatched; the compiler, server, store, connectors, and Studio writer stay out of the
browser runtime. Retain uidl-runtime for a separate rendering slice.

Production uses an inline blob worker and a CSP with `connect-src 'none'`, no inline
scripts/eval, and `worker-src blob:`. Blob workers inherit the document's policy; a
separate worker URL would require its own response header. Development uses Vite's
normal local HMR policy and is not the production security boundary.

## Consequences

- The browser executes the actual engine and can interrupt a synchronous infinite loop
  without freezing the UI. Structural traversal is bounded before serialization.
- Output truncation does not change the actual/expected comparison. Effects and traces
  are inspectable without making external effects look delivered.
- Root dependency installation and build are prerequisites for the kitchen sink; its
  prebuild regenerates KIR so a clean build cannot silently use stale projections.
- Structural limits are not engine instruction-level gas or a browser memory quota.
  This is a bounded shipped-fixture runner, not an arbitrary JavaScript/model sandbox.
- Browser scheduling can delay watchdog delivery in a suspended/background tab. Results
  arriving after the measured deadline are rejected as well.
- Gate acceptance and publication are separate owner decisions; this ADR grants neither.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Main-thread execution with elapsed-time reporting | Cannot interrupt a stuck engine or keep the UI responsive. |
| Compile in the browser | Adds Node-specific dependencies and an unnecessary model-editing surface. |
| Commit KIR fixtures | Creates stale generated copies alongside the source model. |
| A local writable sidecar | Violates the static/no-host-call boundary. |
| A separately fetched worker | Static hosting cannot guarantee a dedicated worker CSP header. |

## Verification

Root unit tests compile the real fixtures and cover outcomes, mismatches, limits,
truncation, cancellation, and deadline cleanup. Playwright drives the production build,
including a deliberately busy worker, source fallback, reset/navigation, role denial,
no host I/O, and inherited CSP network blocking.

References: [Vite 5 workers](https://v5.vite.dev/guide/features.html#web-workers),
[MDN worker CSP](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#content_security_policy).
