# ADR-0037: The Delivery Queue Is Opened Before the Dispatch

- **Date:** 2026-09-30
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

ADR-0034 and ADR-0035 gave the HTTP path a durable outbox, and both named the limit they
could not close: the queue write is not atomic with the record write, because the aggregate
goes through `StorePort` and the queue is a separate store with its own lifecycle. A crash
between the two loses both.

What neither ADR said is how wide that window was, and it was much wider than the two
adjacent writes the limit implied. The order was:

1. write the record,
2. **dispatch every effect** — connector calls, emails, timer registrations,
3. record the events and the failures.

Step 2 is all outbound I/O. The window was therefore the entire duration of the dispatch: a
connector that takes thirty seconds — a rate-limited API, a slow payment gateway, a mail
provider doing a synchronous send — was a thirty-second window in which a crash lost every
event the run emitted and every effect it owed. The limit was real, and it was an order of
magnitude larger than the two writes it was described as.

Two further gaps sat on the same path. The MCP action path dispatched its effects and
recorded *nothing*: an event emitted by a tool call went nowhere, and an undelivered effect
existed only as a line of text in the tool result, naming a failure the caller could not
retry. And the MCP actor was hardcoded to `roles: ["admin"]`, so an MCP tool could not drive
any action the model guards by role — the guard rejected it before anything was emitted, which
is part of why the lost events went unnoticed for as long as they did.

## Decision

**Open the queue before the dispatch, and settle it after.**

```ts
const receipt = this.openDelivery(events, effects, entityName);  // one transaction
const undelivered = await this.dispatchEffects(effects, ...);    // outbound I/O
this.settleDelivery(receipt, undelivered);                       // ack what landed
```

The window is now two adjacent store calls with no I/O between them, instead of the whole
dispatch. An interrupted dispatch leaves the effects pending and drainable rather than absent.

**The record write still comes first, and that order is forced rather than chosen.** Queue
before the record and a crash between the two would leave a host performing effects for a
write that never committed. Losing a promise is recoverable; performing one that should not
have happened is not. A test pins the order by recording both writes and asserting
`["record", "queue"]`.

**Both action paths go through `runWithDelivery`.** HTTP and MCP record a run's promises the
same way, so a run's delivery discipline no longer depends on which interface triggered it.

**The MCP caller supplies the actor's roles**, as the HTTP path does with the request body,
defaulting to `["admin"]` when it supplies none. The guard belongs to the model; a transport
that cannot satisfy it cannot drive the model.

**`attempts` counts every delivery attempt, whoever made it.** Opening the queue first means
the entry exists while the dispatch is in flight, so a failure settles it as a real attempt. A
host draining the queue sees `attempts: 1` for an effect the server already failed to deliver
once, which is the fact it needs before deciding whether to try again. It could not see it
before: the entry was created only on failure and had never been counted, so an effect nobody
had tried was indistinguishable from one that had failed twice.

## Consequences

### Positive

- The crash window shrinks from the dispatch's duration to two adjacent store calls.
- A crash *during* a dispatch leaves the effects pending and recoverable. Previously it lost
  them with nothing left behind to find.
- An MCP-driven run records its events and its undelivered effects. A tool result claiming
  success is now backed by an outbox that agrees with it.
- MCP can drive role-guarded actions, so a model's own permissions are reachable through the
  tool interface.

### Negative

- **Every successfully delivered effect is now written to the session store twice**: queued,
  then acknowledged. Before, a delivered effect was never written at all. That is the price of
  the queue being open during the dispatch, and it is the standard price of an outbox — but it
  is a real cost on the happy path, not a free change.
- Acked entries stay as history rather than being removed, so the effect queue accumulates
  delivered entries for the store's retention. The events outbox already behaved this way;
  the effect queue now matches it.
- The MCP tool interface gains `roles` and `actorId` arguments. They are read out of the
  arguments and never reach the engine's action inputs, which is a subtlety a future change
  to argument handling could break.
- The session store must be present for any durability. A server without one still returns
  the run's events in its response, as before.

### Neutral

- The record-write window itself is unchanged. The aggregate is in `StorePort` and the queue
  is a session store; closing that needs one transaction across two stores, which is a
  different architecture. What changed is that the window no longer contains I/O.
- `enqueueDelivery` queues duplicates for *effects* on a repeated run, while events dedupe on
  the CloudEvent id. Asymmetric, and still stated in its test rather than smoothed over.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Dispatch, then queue, as before | That is the current order. The window is the dispatch, and a crash in it loses everything the run promised. |
| Queue before the record write | A crash between the two leaves a host performing effects for a write that never committed. Worse than losing them. |
| Wrap both stores in one transaction | The aggregate goes through `StorePort`, the ADR-0017 database-adapter boundary, and the queue has its own lifecycle. A cross-store transaction is a different architecture and would make the session the record store. |
| Write an intent record, then dispatch | Solves the window, and needs a second store plus a reconciliation process for intents that never completed. The window was an I/O problem, not a design one. |
| Keep the order, and document the window more precisely | Accurate, and leaves a known loss on the most common failure — a slow connector. |

## Follow-up

- [x] `openDelivery` / `settleDelivery` / `runWithDelivery` in `packages/server`
- [x] A test that the queue holds the effect and the events *while the connector is blocked*
- [x] A test that the record write precedes the queue write
- [x] MCP routes through `runWithDelivery`, with tests for the events and the undelivered effect
- [x] MCP takes `roles` / `actorId` from the tool arguments
- [x] Attempt counts updated, with the reasoning in the tests that assert them
