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

### Documented, or excluded with a reason

The table covers every route the server serves outside the model's own REST surface, including
the metadata ones. Each entry says whether it belongs in the document, and the four that do not
carry the reason in writing:

| Route | Excluded because |
|---|---|
| `/`, `/playground` | Serves an HTML page for a person. A generated client method would return a string of markup. |
| `/openapi.json` | It *is* this document. A path item would describe a document whose own content is what is being described. |
| `/schema.graphql` | Returns SDL text, which a GraphQL client generates itself from. Describing it inside the OpenAPI document describes the description. |
| `/uidl`, `/uidl/{docId}` | **Not excluded.** A UIDL runtime fetches these, so they are API surface and were previously invisible. |

The point of writing the reasons down is that "the served document describes the server" becomes
a claim with no third state: a route is either in the document or it carries a reason it is not.
There is no "forgot about it" case left, and a test enforces it — a reason under forty
characters fails, because a terse one is a label rather than a reason.

Excluded from the document is not excluded from the server. A test asserts every excluded route
still answers 200, since silently dropping a route while tidying the document would be a
regression that reads as a cleanup.

### A behaviour change worth stating

`/uidl` was previously matched with `startsWith("/uidl")` and the document id taken as the
second path segment, so `/uidl/invoices/extra` resolved to the `invoices` document. It is now
matched against the template `/uidl/{docId}` and answers 404. A document is one id, not a path
into a tree, and the old behaviour answered a different question than the path asked. A test
pins it.

## Consequences

### The table

`OPERATIONAL_ROUTES` is the one declaration of each operational route: its path, the matcher
built from that path, whether it needs a session, the name of the handler on the server, and
its OpenAPI shape. The router matches against it and `operationalOpenAPI` builds the document
from it, so a route cannot be served without being described or described without being
served. This replaced an if-chain in `server.ts` (`pathname === "/api/events" && method ===
"GET"`, then a regex for the settlement pair) *and* a hand-written document — two declarations
of the same list.

Handlers are named on the table and defined as private methods, not held as closures in the
table. Closures would hide the control flow inside a data structure, and a name here plus a
method there reintroduces the mapping the table exists to remove. A test walks the table and
asserts every name resolves to a real method, so a route added without a handler fails the
build rather than serving a 500 with no body.

The path parameters are the one thing the table cannot be trusted to hold alone: a matcher
built from `/api/events/{id}/ack` captures one segment, while the regex it replaced captured
two, id and the action. The action is now read from the route's own path, and a test asserts
each pattern captures exactly the parameters its path template declares.

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

## Follow-up

- [x] `operationalOpenAPI(withQueues)` in `packages/server`
- [x] The server merges them in the constructor, keyed on whether a session is configured
- [x] A `$ref` resolution test over the whole served document
- [x] A guard that the emitted document stays model-only
- [x] A test that every documented operational route is actually served, and that every
      operational route the server serves is documented — both directions of drift
- [x] `OPERATIONAL_ROUTES` as the single declaration, read by both the router and the
      document
- [x] Handlers as named methods, with a test that every declared name resolves
- [x] A test that each pattern captures exactly the parameters its path template declares
- [x] The metadata routes in the table, each marked documented or excluded-with-a-reason
- [x] `/uidl` and `/uidl/{docId}` documented, with a recursive `UIDLNode` schema
- [x] A test that every excluded route still answers, so tidying cannot drop one
- [x] README states which document is which
