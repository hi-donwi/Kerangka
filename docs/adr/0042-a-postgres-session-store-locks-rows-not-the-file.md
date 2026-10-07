# ADR-0042: A Postgres Session Store Locks Rows, Not the File

- **Date:** 2026-10-04
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

ADR-0034 gave the HTTP path an optional `session: SessionStoreLike` for everything a run
owed the outside world, and `SqliteSessionStore` implemented the protocol over a file: one
commit is `BEGIN IMMEDIATE`, the revision counter is read inside it, and one sidecar owns
the file through an explicit claim that a second sidecar is refused with
`SessionLockedError`. The Phase 2 handoff named the Postgres version as the next storage
work, with two questions a file store never had to answer:

1. **Who writes.** SQLite's answer is the file lock: one writer, everything else waits or
   fails. Postgres is a server; refusing a second writer would make the durable store
   harder to use than the database it runs on.
2. **What a transaction is.** SQLite owns the handle. The Postgres store is handed an
   executor — `query(sql, values)` — and an executor backed by a pool runs successive
   queries on successive connections, where `BEGIN` on one connection commits nothing the
   next one wrote.

## Decision

**Same protocol, same tables' shape, Postgres semantics.** `PostgresSessionStore` lives in
`packages/server` beside the SQLite store, implements the full `SessionStoreLike` surface,
and never imports a driver. It is handed a `PostgresSessionExecutor` — a structural type
(the ADR-0039 pattern: the shape travels, the dependency does not) whose `query` matches
the executor `adapter-postgres` already defines, plus an optional `transaction(fn)` that
runs a callback on one connection.

**Row-level locking replaces the single-writer claim.** Where SQLite took the write lock
for the whole file, the Postgres store locks one row: the revision counter is read
`SELECT ... FOR UPDATE` as the first statement inside the commit transaction, so the second
writer waits and then reads the first one's number — the property the SQLite store got from
`BEGIN IMMEDIATE`, at the granularity the server can actually offer. Concurrent commits
touching different aggregates proceed; touching the same aggregate serialise on the counter
row and then on their own rows. Two draining hosts do not fight over one event:
`pending()` claims with `FOR UPDATE SKIP LOCKED`, which hands concurrent readers disjoint
pending sets for as long as their transaction stays open. With an autocommit executor the
lock is momentary and the protocol is still correct — at-least-once delivery with idempotent
`ack`, the same guarantee the SQLite store makes. The stale-PID takeover machinery has no
counterpart to replace: a connection that dies rolls its transaction back, and the rows
unlock themselves.

**A write that cannot be atomic refuses rather than shrugs.** `applyEffects`,
`enqueueDelivery`, `enqueueEffect`, `put` and `clear` run inside `transaction`. An executor
without one is refused with an error that says why — a commit split across pool connections
can write the aggregate and lose the event, which is the exact half-run every other store
refuses to hold. Reads and `claim` (a single `INSERT ... ON CONFLICT (key) DO NOTHING
RETURNING key`, race-free by itself) need no transaction and work on any executor.

**Idempotency and dedupe move into single statements.** `claim` is one `INSERT ... ON
CONFLICT DO NOTHING RETURNING key` — the first claim wins by the primary key, not by a
read-then-write race. `enqueueDelivery` dedupes a retried run's CloudEvent id with
`ON CONFLICT (id) DO NOTHING RETURNING id`, so the attempt count of the first queueing
survives. The id namespaces are unchanged from the SQLite store: a commit mints
`effect-<revision>-<index>`, a standalone failure mints `failed-effect-<revision>-<n>`.

## Consequences

### Positive

- An HTTP deployment gets the durable session ADR-0034 promised, on the database it
  already runs, with no new dependency and no driver import anywhere in `packages/`.
- Concurrent hosts can drain the outbox without double-delivering, which a single-writer
  file could not offer at all.
- The protocol is now proven on three backends — memory, SQLite file, Postgres — without
  changing a line of the interface.

### Negative

- The executor contract grows an optional `transaction`, and a caller whose pool wrapper
  does not pin a connection must add one before the durable store works. The refusal is
  loud, but it is still a second step between "I have Postgres" and "I have a session".
- Schema creation is lazy DDL (`CREATE TABLE IF NOT EXISTS`) by default. A deployment that
  wants migrations to own its schema should create the tables itself; the store's DDL is
  idempotent and will agree with whatever it finds or fail loudly on a shape it cannot use.
- The suite tests the store against a scripted executor, so the SQL's *semantics* on a real
  server (isolation levels, lock waits) are argued from the ADR, not exercised. A live
  integration test is welcome and needs infrastructure CI does not have.

### Neutral

- Reads are plain queries; the revision a reader sees is the committed one, as on SQLite.
- `eventLogLimit` stays in-memory-only, as in SQLite: a durable queue is not trimmed by the
  process that fills it.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Keep the single-writer claim on a Postgres advisory lock | It would reproduce the SQLite limitation on a server that does not have it, and an advisory lock held by a dead session lingers where a transaction's row locks do not. |
| Widen `PostgresExecutor` in `adapter-postgres` and import the type | Puts `@kerangka/server` below or beside an adapter for a type it can state structurally in six lines. The shape is the contract; the import is not. |
| Accept non-atomic writes when the executor has no `transaction` | Silently reintroduces the half-run that every durable store in this project exists to prevent. Refusing is louder and cheaper. |
| Implement only the effect half of the protocol (`enqueueEffect`, `pendingEffects`, `ackEffect`, `nackEffect`) | ADR-0034 says the session is "used for effects only" today, but the protocol is one interface, and a store that implements half of it is a trap for the next caller. The whole surface is 15 methods; the marginal cost is small and the margin for drift is zero. |
| Put the store in `adapter-postgres` | The SQLite session store lives in `server` beside the protocol it implements; splitting the family by database would make the protocol harder to compare across stores, which is how it stays honest. |

## Follow-up

- [ ] A live-Postgres integration suite (docker-compose or a service container) exercising
      two executors draining one outbox concurrently; the scripted suite cannot.
- [ ] A `pg`-based executor shipped as a tiny optional package, so hosts do not each write
      their own `pool.transaction`.
- [ ] The JSON-RPC sidecar accepts `--session postgres:...` once a shipped executor exists;
      today a host wires the store in code.

## Amendment: the interface is synchronous, so this store cannot implement it (2026-10-07)

Two claims above were wrong, and the store did not typecheck until they were corrected.
`SessionStoreLike` is **synchronous**: `SessionStore` answers from memory and
`SqliteSessionStore` from `node:sqlite`'s `DatabaseSync`, both of which hold the answer when
the call returns. A query that travels over a socket never does, so
`PostgresSessionStore implements SessionStoreLike` was 31 type errors, and "without changing
a line of the interface" cannot describe a backend the interface was not written for.

What shipped instead is `AsyncSessionStoreLike`, derived from `SessionStoreLike` by a mapped
type over its keys, so the two forms cannot drift apart method by method. The sync interface
is untouched, every existing call site of it still compiles unchanged, and
`PostgresSessionStore` implements the async form.

Widening the sync interface to `T | Promise<T>` was the alternative and was not taken here,
for two reasons that are properties of this codebase rather than of the idea:

- Every existing call site reads its result inline — `store.pending().filter(...)`,
  `for (const entity of store.entities())`, `store.put(entity, computed).record` — so a
  union makes each one a type error to be fixed, not an optional `await`.
- The JSON-RPC dispatcher's contract is a synchronous `(line: string) => string | null`.
  Making the store reachable from it changes the dispatcher, `serveStdio`'s flush loop
  (two `data` chunks must not interleave their responses), and every test that calls
  `dispatch(...)` directly.

The cost is stated plainly: the sidecar and `KerangkaServer.session` do not accept this
store yet. A host that awaits wires it in code today; the framework does not. "Proven on
three backends" is therefore true of the protocol and its methods, not yet of the sidecar.

Follow-up:

- [ ] `SessionStoreLike` becomes promise-aware and the two forms collapse into one, so the
      sidecar and the server accept a Postgres session (`--session postgres:...`). The
      work is the dispatcher's async contract, a serialized `serveStdio` flush, and the
      call sites that read a result inline.
