# ADR-0034: Where a Failed Effect Goes on the HTTP Path

- **Date:** 2026-09-30
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

A run produces host effects: connector calls, notifications, timers. The sidecar has always
queued the ones it did not perform and exposed `pendingEffects`, `ackEffect` and `nackEffect`
for a host to drain, because a store cannot know what "delivered" means.

The HTTP server had no equivalent. `dispatchEffects` caught every failure, logged a warning,
and moved on, so a caller received `ok: true` for a run whose invoice email was never sent.
The `canHandle === false` branch did not even log. The first fix (the previous run) made the
response say what it could not deliver — `effectsFailed`, with `EFFECT_UNHANDLED` for an
extension nothing in the deployment can perform and `EFFECT_NOT_APPLIED` for one that was
attempted and failed.

Reporting is not durability. A reported failure is in one response and gone when the process
is, so the question is where a failure goes so a host can drain it, retry it and acknowledge
it, across a restart.

Three options:

1. **Response only.** Already shipped, and honest. Still lossy on restart.
2. **A second store on the server.** A `SessionStoreLike` alongside the `StorePort`.
3. **Widen `StorePort`.** Cheapest to wire, and the wrong one.

## Decision

The HTTP server takes an **optional** `session: SessionStoreLike`, used for effects only, and
`SessionStoreLike` gains `enqueueEffect(effect)` for the case `applyEffects` cannot express: an
effect that *was* attempted and failed. `StorePort` is untouched.

`StorePort` is the database adapter boundary from ADR-0017. An outbox is not a database
concern; putting one behind that port would make every future store implementation inherit a
queue it has no business holding. The sidecar already has the whole discipline — queue, `ack`,
`nack`, attempt counts, a durable SQLite implementation, a single-writer claim — so the HTTP
path borrows a proven mechanism instead of growing a second one that would drift.

The session is **optional**. A server with no session reports `effectsFailed` in the response
and queues nothing, which is a legitimate and much simpler deployment. `GET /api/effects` then
answers **501** with `EFFECT_QUEUE_UNAVAILABLE` rather than an empty list, because an empty
list is indistinguishable from "nothing failed" — the one thing this endpoint must never imply.

Effects queued this way get their own id namespace, `failed-effect-<revision>-<n>`, because a
commit mints `effect-<revision + 1>-<index>` and a standalone enqueue takes the next revision.
A regression test covers the collision for both stores.

## Consequences

### Positive

- A failed effect is now drainable, retryable and acknowledgeable over HTTP, and survives a
  restart when the session is the durable `SqliteSessionStore`.
- The queued entry carries the effect itself, so a host performs the real call rather than a
  description of it.
- One mechanism, not two. The sidecar's discipline is unchanged and now has a second consumer.

### Negative

- **The queue is not atomic with the record write, and cannot be.** The aggregate is stored
  through `StorePort` and the queue is a separate store with its own lifecycle, so a crash in
  the window between them still loses the effect. Everything else is recoverable; that window
  is not. Closing it means one transaction across two stores.
- A second store to configure, and a second lifecycle to reason about — the cost of option 2
  over option 1, paid knowingly.
- The effect id scheme is now produced in two places with different offsets, and the durable
  one is on disk in existing session files, so it cannot be changed to match.

### Neutral

- `/api/effects/*` is a hand-written route and is not in the emitted OpenAPI document, exactly
  as `/api/mcp/*` is not. That gap predates this decision and now covers more surface.
- **Events** were out of scope here and are [ADR-0035](0035-http-event-outbox.md), which shares
  one transaction with this queue and so closes the window *inside* the queue. The window
  between the record write and the enqueue remains, and is recorded there.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Response only | Loses the failure on restart. Kept as the behaviour when no session is configured. |
| Widen `StorePort` to hold effects | Puts an outbox behind the database-adapter boundary of ADR-0017, and every store implementation inherits a queue it has no business holding. |
| Make the session required | A server that reports failures in its response and cannot queue them is a legitimate deployment; requiring the queue would make the simple case pay for the complex one. |
| Queue inside the record write "for atomicity" | Two adjacent writes are still two writes. Reordering would also invert the failure: an effect queued for a write that never happened. |

## Follow-up

- [x] `enqueueEffect` on `SessionStoreLike`, `SessionStore` and `SqliteSessionStore`
- [x] `KerangkaServer({ session })` and the three drain endpoints
- [x] Id-namespace regression tests
- [x] An outbox for **events** on the HTTP path, sharing one transaction with the effect queue —
      [ADR-0035](0035-http-event-outbox.md), which closes the queue-internal half of the window
