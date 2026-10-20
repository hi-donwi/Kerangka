# Kerangka Studio

Status: CP0 accepted on 2026-10-16. P1 supplies a local read-only workbench; see the
[launch guide and verified boundary](read-only.md). P0 design acceptance and P1 local tests
are not production-readiness or writable/shared-preview approval.

## Decisions and Artifacts

| Artifact | Purpose |
|---|---|
| [Read-only guide](read-only.md) | Launch, implemented profile, verification, and unsupported/remaining gates |
| [Console design](design.md) | Workbench structure, tokens, responsiveness, and accessible states |
| [ADR-0049](../adr/0049-studio-is-an-authoring-host-not-a-second-engine.md) | Ownership, source-backed reuse audit, app/service boundaries, and graph strategy |
| [Source-bundle contract](source-bundle.md) | Version, raw sources, page ownership, routes, revisions, and validation stages |
| [JSON Schema](../../spec/studio/source-bundle.schema.json) | Offline structural authoring envelope, distinct from runtime/authorization validation |
| [Security model](security.md) | Threats, enforcement owners, acceptance tests, resource budgets, and execution gates |
| [Contract tests](../../packages/cli/test/studio-contract.test.ts) | Positive/negative envelope fixtures and pure-engine approval semantics |
| [Approval model](../../packages/cli/test/fixtures/studio/approval.kerangka.json) | Small synthetic employee/manager model using existing syntax |

## First Target

One local application, React, English UI labels, synthetic data, and a configurable
`/studio` mount. The first app is a request approval demonstration, not payroll, ERP,
an authentication provider, or a general multi-tenant platform. The future business API
uses Hono's host-resolved context; Node may host local compiler/file jobs but the Node
sidecar is not presumed to have Hono's KX-01 boundary.

The reference integration target is a disposable PostgreSQL database and a verified
host session, subject to the actual deployment target's version selection. P0 opens
no connection. SQLite/memory remain options for a synthetic local preview, not substitutes
for proving the chosen production store. PostgreSQL results do not certify D1 or any
other adapter.

## Acceptance Scope

| Scenario | Required outcome | Evidence stage |
|---|---|---|
| Create and submit | An employee creates only their own draft and submits it | Pure-engine fixture tests in P0; direct HTTP proof before writable preview |
| Approve/reject | A different manager transitions a submitted request | Model fixture; complete UI/API journey in P3 |
| Denials | Employee/anonymous approval, self-approval, another employee's submit, and invalid state are denied | Pure-engine fixture tests; host/API denial and revocation tests remain required |
| Bypass prevention | Generic update/delete are closed; create cannot pre-approve | Model permission fixture; real handler/store enforcement is not certified by unit tests |
| Model editing | Add one optional field and inspect form/API/SQL impact | P2, not implemented in P0 |
| Presentation | Change form sections and navigate generated list/form | P2/P3; arbitrary route/page authoring is P4 |
| Save/export | Preserve source, detect external revision conflicts, and recompile without Studio | P2/P3, not implemented in P0 |
| Isolation | No real connector, production record, secret, or external effect in preview | P1 security tests and separate integration gate |

The fixture intentionally grants read to both demonstration roles in a single synthetic
application. It does not promise employee-private reads, tenant isolation, session security,
or production-ready identity policy. Those policies must be designed and tested at the
host/store gate; do not deploy the fixture as an identity or tenant-isolation template.
There are no connector calls, timers, emails, or external side effects in the fixture.

## Verification

From the repository root, with Node 22 and the lockfile-installed dependencies:

```sh
npm ci --ignore-scripts
npm test -- packages/cli/test/studio-contract.test.ts test/adr-index.test.ts
npm run build
npm run verify
npm run test:conformance
npm audit
```

Ajv `8.20.0` is a pinned, MIT-licensed **dev-only** dependency for independent JSON Schema
2020-12 validation. It adds no business/runtime dependency and uses no remote schema loader.
The P0 contract/engine fixture tests do not mutate source, apply DDL, start a server,
authenticate a user, or prove a browser sandbox. Repository-wide verification also runs
the existing adapter, HTTP, and sidecar test harnesses. If `KERANGKA_POSTGRES_URL` is set,
it must name a dedicated disposable test database: the existing PostgreSQL integration
suite creates and drops tables. Never point it at production or a shared application database.
A schema-valid envelope may deliberately contain an unfinished draft; validation stages
in the contract decide whether it can compile, preview, or release.

## CP0 Review

The owner accepted the delivered P0 design on 2026-10-16 and authorized P1 read-only work:

- [x] Accept ADR-0049, reuse boundaries, and reserved app/service locations.
- [x] Accept source-bundle 0.1, JSON/YAML scope, and page ownership rules.
- [x] Accept the threat model, budgets, and enforcement/test ownership.
- [x] Accept the synthetic fixture's scope and the remaining direct API/browser criteria.
- [x] Confirm P1 read-only scope; estimates remain indicative, not staffing/date commitments.

CP0 acceptance permits a separately scheduled P1 read-only explorer, not P2 source writes,
hosted access, database changes, or release. P1 can use synthetic data without waiting for
the entire multi-tenant RFC. Writable/shared preview additionally requires authenticated
host-to-store isolation, revocation, idempotency, rollback, and concurrency evidence.

Acceptance of this design does not activate a live environment or authorize publication.
