# Studio Security Model and Budgets

Status: CP0 design baseline accepted on 2026-10-16. P0 supplies a contract and test
fixtures, **not** a Studio server, filesystem sandbox, authenticated host, browser isolation,
or database-conformance implementation. Unless explicitly marked as a P0 fixture check,
verification below is required future work, not a passing test result.

The [P1 read-only guide](read-only.md) records the currently implemented and locally tested
subset. This baseline still defines later obligations; do not treat its acceptance matrix
as a claim that every control, platform, or benchmark has been certified.

## Assets, Actors, and Trust Boundaries

Protect source confidentiality/integrity, host credentials, actor/tenant authority, draft
history, application data, and machine resources. Treat imported models, source strings,
UIDL documents, package/connector output, AI proposals, URLs, and browser messages as
untrusted data. A schema-valid model is not a trusted program or an access grant.

Threat actors include a hostile website reaching localhost, a malicious import/document,
an unauthorized business user, a stale/revoked session, and a concurrent local writer.
Compromise of the OS/user account or a malicious installed toolchain is outside the local
process threat boundary; do not describe loopback tokens as protection against that actor.

```text
Local operator -> Studio control plane -> confined source/job service
                                  -> compiler / validation subprocess
                                  -> isolated synthetic preview

Preview intent -> separately permitted host bridge -> verified principal
               -> Hono -> scoped store -> selected database
```

The control plane and business plane are separate. Future designer capabilities such as
source read/edit, security review, and publication come from the authoring host, never from
an application's employee/manager roles. A preview cannot call the source-write service.
No shared/hosted control plane is enabled until its identity, authorization, audit, and
recovery gates pass. P1 is loopback, read-only, one project, and synthetic data only.

## Security Acceptance Matrix

| ID | Threat / invariant | Enforcement owner and required control | Required evidence / gate |
|---|---|---|---|
| S-01 | Hostile site or DNS rebinding reads source | Local service binds loopback; exact Host/port allowlist, rejected cross-site fetch metadata, checked Origin, per-process/project capability token; no wildcard CORS | P1 HTTP tests: forged Host, hostile/null Origin, missing token, and cross-site request return no source |
| S-02 | Localhost is mistaken for authentication | Control-plane token is bootstrapped through a trusted local launch channel, scoped to project/process, never in query/path/log/localStorage; Origin absence does not remove token validation | P1 tests for token scope/restart, unauthenticated local requests, and nonbrowser requests |
| S-03 | Save or security/publish action is forged | Authoring host declares capability per mutation; cookie sessions use HttpOnly/Secure/SameSite and CSRF/Origin protection; revision approval is separate from authentication | Before writes/hosting: wrong capability, revoked session, forged CSRF, stale revision/approval denied |
| S-04 | Path traversal, symlink race, case alias, hidden/derived file | Source service confines canonical paths and opened handles to an allowlisted root, denies duplicate keys and aliases, and does not follow import paths into the machine | P0: lexical rejection fixtures only. P1: actual filesystem traversal/symlink/race/alias tests; no read outside root |
| S-05 | Compile/lock resolution reads files or installs packages outside policy | Job host supplies confined filesystem/package access, no automatic npm/Git/network fetch, bounded parser/job; model/lock references cannot grant access | P1: malicious context/package/lock references denied before outside I/O; source-root setup alone is insufficient |
| S-06 | Preview obtains authoring cookies/tokens | Separate preview origin and cookie namespace, sandbox, narrow CSP, no credentials in preview state, credential-omitting bridge | P1 browser tests: preview cannot read source, authoring cookies, local storage, or parent DOM |
| S-07 | Forged window messages perform a privileged action | Per-frame channel/capability, event.source/frame binding, validated message vocabulary, current revision, bounded payload, explicit permitted intent | P1 browser tests: another frame, stale frame, wrong capability, and unknown command cause no action |
| S-08 | UIDL makes real mutations, API calls, downloads, popups, or navigation | Host enforces read-only/synthetic profile; no mutation/non-read command/API handler by default; navigation and asset destinations allowlisted; browser CSP denies egress | P1 browser/network assertions and malicious-document fixtures, not a hidden button or a `profile` label |
| S-09 | Untrusted content becomes script/HTML/plugin execution | Registry and parser are allowlisted; text is escaped, HTML sanitized where supported; no eval/custom widget auto-loading or source-provided schema compilation | Before preview: script/URL/plugin payloads remain inert; Builder's metadata registry is not accepted as isolation |
| S-10 | Client supplies actor, roles, tenant, or bypasses revocation | Business host authenticates current session/membership on each request and supplies Hono `resolveContext` with `{ id, roles, tenantId }`; no context-header trust in shared use | Before writable/shared preview: forged headers/body/query and revoked role are denied, including idempotency replay |
| S-11 | Store leaks or overwrites another tenant | Store enforces trusted scope, actual key/discriminator semantics, concurrency/versioning, and supported transaction boundaries | Real-store gate: list/item/query/screen/action/write paths, same IDs, missing tenant, custom discriminator, rollback and concurrency |
| S-12 | Connector or schema reference exfiltrates data | Host allowlists destinations and secret references; redirects/private-address rebinding controlled; schema IDs never cause fetches; preview has no outbound connectors | P0: trusted local Ajv schema only. Before connector use: blocked redirect/private destination and no network from preview |
| S-13 | Secrets leak via otherwise valid source, export, diagnostic, telemetry, or AI | Host secret resolution outside documents, minimized source selection, redaction, no raw-source telemetry/prompt by default; provider use requires explicit approval | Before export/AI/hosting: sensitive synthetic markers never leave allowed destinations; scans alone are not proof of arbitrary-text safety |
| S-14 | Concurrent writer or generation destroys authored content | Host-issued expected revision, external-edit detection, atomic replacement, recipe/authored ownership, source-only fallback, recoverable conflict | Before save: stale source/Git edit, partial-write failure, regenerate and undo/redo preserve both content versions |
| S-15 | Imported model exhausts CPU/memory/history | Schema ceilings plus byte/parser/node limits, capped isolated jobs, cancellation, queue/history/cache limits, timeout/termination | P0: structural count/length fixtures. Before execution: actual oversized/deep/expensive jobs terminate within the budget |
| S-16 | A valid draft is treated as permission to release or migrate | Revisions/build inputs pinned; reference/semantic/security checks; compatibility and migration rehearsal; separately authorized activation | Before release: invalid/stale/unsafe change cannot activate; source rollback is not described as data/schema rollback |

The proposed local token is not application authentication. Browser GETs can omit Origin,
so capability validation is always required; if Origin is present it must match the console,
and cross-site fetch metadata is rejected. Mutation Origin policy is stricter. Do not accept
`Origin: null` at the authoring API merely because a sandboxed preview can have an opaque origin.

## Preview Isolation Details

Separate **origins and cookie namespaces**; different ports on the same host alone do not
isolate cookies. An illustrative pairing is console `127.0.0.1:8080` and preview
`localhost:8081` with host-only cookies and no Domain sharing. No deployment may assume
that port separation alone is credential isolation.

The default preview frame allows only the scripts needed by its trusted renderer bootstrap;
it does not grant same-origin, forms, popups, downloads, or top navigation. Prefer an opaque
sandboxed frame and a narrow channel over exposing authoring tokens. An opaque frame's
message origin may be `null`: validate its exact Window/channel and unguessable per-frame
capability, not the string `null` as an allowlisted authority. Bootstrap/postMessage handling
must be proved in the actual browser; the frame attribute itself is not that proof.

Apply restrictive response CSP: no unapproved connect/image/media/font/frame destinations,
no object/base/form escape, and only trusted renderer assets/scripts. Use synthetic
in-memory DataAdapter results. Do not pass a live server/client, production session, or
authoring credentials into the renderer. Runtime profile enforcement (UX-04) and generic
host routing (UX-05) remain upstream contracts to consume, not assumptions about the current
runtime. A Web Worker/iframe alone is neither filesystem nor network confinement.

## Resource Budgets

These are **proposed initial policy limits**, not measured results. CP0 may revise them
explicitly. Future implementations must reject excess with stable diagnostics before work,
or cancel/terminate a running job without losing the draft. Do not truncate source silently.

| Resource | Initial ceiling / target | Required enforcement |
|---|---|---|
| Sources | 128 files; 524288 Unicode code points per text | Schema checks already covered; not a UTF-8 byte guarantee |
| Host input | 512 KiB UTF-8 per file; 4 MiB HTTP envelope and 4 MiB aggregate decoded text | Service measures bytes before parse/compile; also apply limits when opening a local project |
| Parse expansion | Maximum nesting 32; YAML aliases disabled initially | Parser boundary before expensive traversal; source-only diagnostic for unsupported input |
| Model fixture scale | 50 entities / 500 fields total; 100 pages / 100 routes | Validate actual resolved graph, not only envelope counts |
| Canvas scale | 250 visible graph nodes / 500 edges; 500 rendered UIDL nodes | Scope views and enforce limits; editor positions may contain at most 2000 entries |
| Evaluation | 10000 expression-node evaluations per scenario; no statement nesting beyond engine's existing limit of 8 | Job/engine boundary must enforce or reject before enabling simulation; no claim that current engines expose an instruction meter |
| Jobs | One active compilation per project, at most two queued; 5 s wall timeout; scenario timeout 2 s | Isolated job host; cancel superseded revisions, terminate timed-out jobs; worker threads alone do not confine filesystem/egress |
| Preview | One frame/store per open project; no live connectors or external API calls | Host lifecycle and CSP/handler policy, with teardown verified |
| History/cache | 50 undo entries or 8 MiB, whichever first; 20 MiB compiled cache per project | Bound complete entries, communicate history eviction; no cross-project/actor data cache reuse |
| Diagnostics | At most 100 entries, each at most 1 KiB; no raw source or absolute paths by default | Service boundary/redaction, with structured codes and relative pointers |
| Process/browser memory | 256 MiB service RSS and 128 MiB preview JS heap target at reference fixture scale | Benchmark built artifacts and document measurement method; exclude toolchain/dev-server overhead explicitly |

Performance reference: a local machine with at least four logical CPU cores, 8 GiB RAM,
and a current supported Chromium browser, using deterministic synthetic fixtures and warm
built assets. Targets: project open p95 <= 2 s, inspector/select interaction p95 <= 100 ms,
and preview ready p95 <= 2 s at the agreed scale. Record versions, hardware, sample count
(at least 30), warm/cold distinction, memory method, and cancellation behavior. No benchmark
has been run in P0, and npm unpacked package size is not evidence of meeting these budgets.

## Authenticated Host and Store Gate

Before writable/shared preview, exercise a real session resolver and a disposable instance
of the selected database, not production data. Use two synthetic tenants and users with
revocable roles. Required assertions include scoped lists/details/named queries/screens,
create/update/delete/actions, two tenants with the same record ID, missing tenant, a custom
discriminator, forged scope, role revocation before retry/replay, version conflicts, and
rollback within the store's declared transaction boundary. Record actual results per path;
do not hide a keying defect by testing only different UUIDs.

Hono metadata/static UIDL routes intentionally differ from protected data routes; do not
misreport public metadata as an authenticated read proof. ADR-0047 is Hono-only. The Node
sidecar and other language adapters need their own trust-boundary proof if used. A passing
memory store, pure engine, or PostgreSQL test does not certify another adapter.

Do not promise arbitrary multi-aggregate atomicity, exactly-once external effects, or closure
of the HTTP record/outbox split. Follow the current aggregate boundary and the upstream
unit-of-work decision. AI, arbitrary connector execution, production DDL, hosted authoring,
and publication stay disabled until their own authorization and verification gates pass.
