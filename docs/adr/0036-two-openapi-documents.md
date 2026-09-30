# ADR-0036: Two OpenAPI Documents, Two Meanings

- **Date:** 2026-09-30
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

`keranga emit openapi` and `GET /openapi.json` returned different documents, and only one of
them was a description of anything you could call.

The emitter turns a `KIRDocument` into a document about a **model**. The server served a
document generated the same way, so it described the model too — and omitted every route the
server actually serves that the model does not describe: `/api/mcp/*`, and now `/api/events`
and `/api/effects` with their `ack` and `nack` routes. The outbox and the effect queue are
precisely the surface a host needs, and a consumer generating a client from `/openapi.json`
saw none of it.

The obvious fix — teach the emitter about the operational routes — is wrong, and the reason
is specific. The emitter cannot know whether they exist. `/api/events` exists only when the
server was started with a session; a document emitted from the model alone has no way to
know, so it would have to advertise a path that the deployment may not serve.

## Decision

**The served document describes the running server. The emitted document describes the model.
Both are correct; they are different things, and each is named for what it is.**

`packages/server/src/operational-openapi.ts` owns the operational routes, and the server
merges them into its own document in the constructor. The queue routes are included only when
a session is configured, and a path this deployment cannot serve is not advertised at all.

Two properties follow, and both are tested:

- **Every `$ref` in the served document resolves.** A dangling reference is worse than a
  missing schema: the document looks complete, and every client generated from it fails to
  compile. The outbox entry's `event` needed a `CloudEvent` schema, which is why one is
  declared there rather than left to a consumer to infer.
- **The emitted document carries no operational routes and no queue schemas.** An emitted
  document is a file someone generates a client from and then runs against a deployment; a
  path advertised there that the deployment does not serve is a promise the code cannot keep.
  This is guarded in `packages/compiler/test/projections.test.ts` so the boundary cannot be
  quietly undone by someone tidying the emitter.

`/api/mcp/*` is included for the same reason as the queues. It was never model-derived either,
and leaving it out would keep "the served document is complete" false.

## Consequences

### Positive

- A client generated against a running server can see, and call, the outbox and the effect
  queue — the operational surface, with operation ids, request bodies and 404s.
- The two documents have a defensible meaning each, so neither has to be a compromise.
- A deployment without a session does not advertise a queue it cannot serve.

### Negative

- Two documents exist and they differ. Anyone expecting `keranga emit openapi` to match
  `/openapi.json` byte for byte is wrong, and the README says so.
- The operational schemas now live in two packages: the queue entry shapes are described in
  `packages/server`, next to the code that produces them, and not in the compiler. A consumer
  that wants the model surface and the operational surface has to take them from two places.
- The served document changes with configuration. Two servers running the same model on
  different settings serve different documents, which is correct and occasionally surprising.

### Neutral

- The routes are still hand-written on both sides: the server implements them and the
  operational document describes them. A drift test compares them, but a new route needs both.
- The record-write window from ADR-0034 and ADR-0035 is untouched by this decision.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Teach the emitter about the operational routes | The emitter cannot know whether a deployment has a session, so it would advertise `/api/events` to a server that answers 501. |
| Merge the operational routes into every emitted document, always | Same problem, and it would put transport concerns into a compiler that should know only about models. |
| Serve the emitted document unchanged and let clients discover routes at runtime | Discovery is not a contract. A generated client still cannot call the outbox. |
| Declare the operational routes as a model extension | Makes a deployment detail part of the model, which every other emitter would then have to understand. |
| Generate the operational document from the router's own route table | The right end state, and the router has no table — it dispatches on `pathname ===` strings inside one method. Building the table is a larger change to the server than this defect warrants, so this run tests both directions of drift instead and leaves the generation for later. |

## Follow-up

- [x] `operationalOpenAPI(withQueues)` in `packages/server`
- [x] The server merges them in the constructor, keyed on whether a session is configured
- [x] A `$ref` resolution test over the whole served document
- [x] A guard that the emitted document stays model-only
- [x] A test that every documented operational route is actually served, and that every
      operational route the server serves is documented — both directions of drift
- [x] README states which document is which
