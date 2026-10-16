# RFC: Host Embedding in Multi-Tenant Platforms and Standalone Application Export

- **Author(s):** The Kerangka Authors (hi-donwi)
- **Created:** 2026-10-16
- **Status:** Draft
- **Target Specification Version:** 0.2 (KX-01–KX-04, KX-10), 0.3 (KX-07–KX-09), Horizon 2 (KX-05, KX-06)

## Summary

Kerangka models increasingly run inside a host platform that serves many tenants and composes each tenant's application from reusable packages. Later, the same model should become a standalone application that one tenant owns and runs without the platform, with UIDL frontends. This RFC lists ten upgrades (KX-01 to KX-10) that make both uses safe, in the order they should land.

## Problem Statement and Motivation

A host platform needs to run Kerangka on behalf of many tenants, at the edge, from models it composes at run time, and then export one tenant's model as an application. Current gaps:

| # | Gap | Evidence |
|---|---|---|
| 1 | The tenant and actor come from request headers or a query parameter, so a client chooses its own tenant | `packages/adapter-hono/src/hono-app.ts` (`getTenantId`, `X-Tenant-Id`, `X-Actor-Roles`) |
| 2 | No store adapter for edge SQL databases whose atomic primitive is a statement batch, not an interactive transaction (for example Cloudflare D1) | `packages/adapter-sqlite` uses `node:sqlite`; `packages/adapter-postgres` needs a socket |
| 3 | Some runtime packages import `node:` modules | `packages/adapter-hono/src/idempotency.ts`, `packages/ports/src/outbox-bus.ts`, `memory-scheduler.ts`, `store-scheduler.ts` |
| 4 | Compilation reads files; a host compiles composed documents in memory | `packages/compiler`, `packages/cli` |
| 5 | Tenant overlays (ADR-0031, Horizon 2) are accepted but not implemented | No overlay code in `packages/*/src` |
| 6 | ADR-0010 allows one aggregate per action; ledger-style posting writes a document, its entries and open items together and must not be partially visible | `docs/adr/0010-single-aggregate-transactions.md` |
| 7 | Payroll-style component rules (fixed, percentage, capped bases, ceilings, rounding stage, effective dates) have no conformance coverage | `conformance/` |
| 8 | No contract for loading a typed data export into a generated application's store | - |
| 9 | `kerangka scaffold` writes models plus a health route; the TypeScript backend depends on `workspace:*` packages and cannot install outside this monorepo | `packages/cli/src/commands/scaffold.ts` |
| 10 | Hosts pin immutable artifacts and need a stated compatibility policy across KIR, engines and the UIDL projector | `CHANGELOG.md`, release workflow |

## Proposed Design

### KX-01 — Host-owned actor and tenant scope

Adapters accept a host hook: `resolveContext(request) => Promise<ActorContext | null>`, where `ActorContext` is `{ actorId, roles, tenantId }`. When a hook is supplied, headers and query parameters are ignored. Header-derived context is available only with an explicit `trustContextHeaders: true` option, which `kerangka dev` sets and production adapters do not. A model with `multitenancy` and a run with no `tenantId` fails closed with `TENANT_REQUIRED` (ADR-0008).

### KX-02 — Edge SQL store adapter and store conformance kit

`@kerangka/adapter-d1` implements the async store port over a minimal executor interface (`prepare(sql).bind(...values)`, `batch(statements)`). One run commits as one batch: the aggregate row with an optimistic-version compare-and-swap, child rows, outbox entries and effect queue entries. A guarded update that matches zero rows must abort the batch through a statement that fails on that condition; a silently skipped update is not acceptable. Predicate pushdown and `readFilter` follow ADR-0039 to ADR-0041. A shared store conformance kit runs against memory, SQLite, Postgres and D1 adapters.

### KX-03 — Edge runtime portability

`@kerangka/k1`, `@kerangka/engine-ts`, `@kerangka/ports` and `@kerangka/adapter-hono` run without `node:` modules: WebCrypto for hashing and ids, timer-free schedulers in the default entry, and Node-only pieces behind `/node` subpath exports. A CI job runs the engine, server and D1 adapter suites inside a Workers runtime.

### KX-04 — In-memory compile API

```ts
compile({
  documents: Record<string, unknown>,   // path -> parsed document
  packages: PackageResolver,            // host catalog lookup, no file system
}): { kir: Kir; hash: string; diagnostics: Diagnostic[] }
```

The result is pure and deterministic: canonical JSON (sorted keys, normalized numbers) gives a stable `hash`, so a host can cache compiled models per tenant revision. The CLI becomes a thin file-system wrapper around it.

### KX-05 — Tenant overlays

An overlay document targets one base model:

```json
{
  "kerangka": "0.3",
  "overlay": "invoicing",
  "entities": {
    "Invoice": {
      "fields": { "costCenter": "string" },
      "labels": { "dueDate": "Payment due" }
    }
  },
  "decisions": { "LateFee": { "versions": [{ "validFrom": "2027-01-01", "rows": [] }] } },
  "workflows": { "Invoice": { "extend": { "afterApprove": [{ "notify": "finance" }] } } }
}
```

Allowed: labels, new optional fields, new decision-table and rule versions, steps at extension points that the base declares. Refused at compile time: removing or retyping fields, removing rules, invariants or permissions, widening a permission, adding steps where the base declares no extension point. `kerangka diff` reports an overlay that a new base version breaks before that version is adopted.

### KX-06 — Same-store unit of work (decision required)

Three options for document-plus-entries writes:

| Option | Behaviour | Cost |
|---|---|---|
| A | Opt-in `unitOfWork: "context"` on an action: a run may write several aggregates of one bounded context that live in one store, committed in one transaction or batch | Amends ADR-0010; needs conformance for partial-failure and concurrency |
| B | A connector marked `transactional` whose writes join the store commit when it shares the store | Couples connectors to stores |
| C | Keep ADR-0010; model posting as a saga with explicit pending states, idempotent effect keys and the outbox | No change; more states in models |

Proposal: adopt C now and document the pattern with a ledger-style example. Evaluate A behind a flag, with invariants such as "entries balance" checked inside the unit of work, and record the outcome as an ADR.

### KX-07 — A real `kerangka eject`

```text
kerangka eject <model> --backend ts-workers|ts-node|go --db d1|sqlite|postgres --frontend react-uidl
```

The generated backend runs the engine, store, server, outbox and declared connectors. The generated frontend renders projected or supplied UIDL documents through the UIDL-Runtime host shell. Dependencies name published versions only. `src/generated/**` is regenerated by `kerangka eject --update`; `src/custom/**` is never touched. Generated CI runs `kerangka verify` and a conformance subset. `scaffold` becomes an alias of `eject`.

The generated project contains only the packages the model uses. A host can pass the implementations of declared connectors as local packages (`--with-package <name>=<path>`). `eject` places them under `src/packages/**`, wires them to their connectors and lists them in the generated manifest. The project must not reference anything that is neither in the model nor passed explicitly.

### KX-08 — Typed data import

`kerangka import <bundle> --into <store>` loads JSON Lines files, one per entity, with children inline. Natural keys make reruns idempotent. A dry run reports row errors. The command finishes with control totals by entity and by numeric field.

### KX-09 — Rule-set conformance for payroll-style components

New conformance cases: fixed, percentage and capped components; wage-base ceilings; a named rounding stage; effective-dated versions at boundary dates; a decision table that selects a component set by an input category. All amounts and rates are decimal wire strings (ADR-0004). Example values are synthetic and tied to no jurisdiction.

### KX-10 — Release and compatibility policy

Separate version numbers for the KIR format, engine semantics and projector output. Each release ships immutable tarballs with checksums. A compatibility table maps Kerangka releases to UIDL-Runtime releases. Deprecations have a stated window. A host pins all three versions and upgrades them deliberately.

### Order

KX-01 → KX-03 → KX-04 → KX-02 → KX-10 → KX-06 → KX-05 → KX-09 → KX-08 → KX-07.

KX-01 is a security fix and lands first. KX-07 waits for the UIDL-Runtime host shell and typed import.

## Concept Budget Impact

KX-05 implements a concept already accepted in ADR-0031. KX-06 option A would add an option to an existing concept (action), not a new concept. KX-01 to KX-04, KX-07, KX-08 and KX-10 are adapter, API and tooling changes. KX-09 adds conformance only.

## Conformance and Cross-Engine Impact

- KX-01: forged header with a host context, missing tenant on a multitenant model, revoked role between two requests.
- KX-02: store kit cases for guarded-write failure rolling back the batch, concurrent writers, outbox atomicity.
- KX-05: overlay merge, refused weakening, overlay compatibility after a base upgrade.
- KX-06: partial failure and concurrency for whichever option is accepted.
- KX-09: the rule-set cases above in TypeScript, Go, Python and Dart engines.

## Compatibility and Migration (Expand/Contract)

KX-01 changes a default: header-derived context stops working unless `trustContextHeaders` is set. This is a security change, released with a CHANGELOG entry and the flag as the migration path. KX-07 keeps `scaffold` working as an alias. All other items are additive.

## Alternatives Considered

| Alternative | Why rejected |
|---|---|
| Hosts strip headers themselves | Every host must remember it; one omission leaks tenants |
| Hosts fork Kerangka for their needs | Splits the standard and its conformance |
| Multi-aggregate transactions by default | Rejected by ADR-0010 for scalability; at most an opt-in within one store |
| Generating hand-editable code with no regeneration boundary | Exported applications could never take model upgrades |
