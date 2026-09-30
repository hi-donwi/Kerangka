# ADR-0035: The HTTP Path Queues the Events a Run Emitted

- **Date:** 2026-09-30
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

The sidecar has always queued the events a run emitted: `applyEffects` writes aggregates,
enqueues events and queues unperformed effects in one transaction, and a host drains the
outbox with `outbox`, `ack` and `nack`.

The HTTP server had no outbox at all. `result.events` went into the response and nowhere
else, so a client that dropped the response — a timeout, a retry, a dropped connection —
lost the event permanently. Nothing could recover it, because nothing had it.

ADR-0034 fixed the sibling gap: effects a run could not deliver are now queued. It left one
window open, and named it: the queue write is not atomic with the record write, because the
aggregate goes through `StorePort` and the queue is a separate store with its own lifecycle.

## Decision

When the server is started with a `session`, a run's events go into that session's outbox,
through a new `enqueueDelivery(events, effects, entity?)` on `SessionStoreLike`.

**Both halves, in one transaction.** The events a run emitted and the effects it could not
deliver are one fact — *this run promised these and could not do those* — and two separate
calls would leave a crash between them. That is the same window ADR-0034 accepted for the
record write, and there is no reason to add a second one inside the queue.

**Events are keyed by CloudEvent id.** A retried request re-runs the action and re-emits the
same id, so the outbox uses `INSERT OR IGNORE` on it. Queuing the same event twice is the
one thing an outbox exists to prevent, and re-inserting would also reset the attempt count,
so a host retrying under load would never see an attempt it could alert on. Effects have no
natural key, so a repeated `enqueueDelivery` queues another copy; a host acking both is
harmless, and the alternative — inventing an idempotency key for an effect — would be a
contract with nothing behind it.

**The response does not change.** The events are already in it, with their ids, so a host
correlates the response with the outbox exactly. The declared contract gains nothing, and the
envelope stays `additionalProperties: false`.

**Without a session, nothing is queued** and `GET /api/events` answers **501** with
`EVENT_OUTBOX_UNAVAILABLE`. The same reasoning as ADR-0034: an empty outbox is
indistinguishable from a run that emitted nothing, which is the confusion this work exists
to remove.

## Consequences

### Positive

- An event survives the response. A host drains, retries and acknowledges it, across a
  restart when the session is the durable `SqliteSessionStore`.
- The queue-internal half of ADR-0034's window is closed: a run's events and its undelivered
  effects are recorded together or not at all.
- Both transports now share one queue discipline and one implementation, rather than the sidecar
  having an outbox and HTTP having a log line.

### Negative

- The record-write window from ADR-0034 remains. The aggregate is stored through `StorePort`
  and the queue is a separate store, so a crash between the write and the enqueue still loses
  both. Closing it needs one transaction across two stores, which is a different architecture
  and would mean the session becoming the record store.
- Repeated `enqueueDelivery` of the same *effects* queues duplicates. Asymmetric with events,
  and stated in the test rather than smoothed over.

### Neutral

- `/api/events/*` and `/api/effects/*` are hand-written routes and are not in the emitted
  OpenAPI document, exactly as `/api/mcp/*` is not. A consumer generating a client from the
  document sees none of them. The gap predates both ADRs and now covers more surface.
- With a session configured, every run writes to two stores. That is the cost of durability
  on a path whose record store is chosen separately.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Return the events and leave it there | A dropped response loses the event with no record of it existing. That is the gap. |
| Persist events into `StorePort` | Same boundary problem as ADR-0034's rejected option: an outbox behind the database-adapter port. |
| Enqueue events and effects separately | Two calls, one crash window, inside the part of the system that *can* be a single transaction. |
| Put the events in the response only, plus a retry endpoint keyed by idempotency | A retry still needs the events stored somewhere to be replayed from. |
| Change the response to omit the events now that they are queued | Breaks every existing caller for a server-side gain, and loses the correlation a host can do today. |

## Follow-up

- [x] `enqueueDelivery` on `SessionStoreLike`, `SessionStore` and `SqliteSessionStore`
- [x] Events queued from the action path and the scheduled-job path
- [x] `GET /api/events`, `POST /api/events/{id}/ack`, `POST /api/events/{id}/nack`
- [x] A cross-store parity test for the new method
- [ ] The record-write window: one transaction across the record store and the queue, or a
      documented reason it stays
- [ ] Hand-written routes in the emitted OpenAPI document
