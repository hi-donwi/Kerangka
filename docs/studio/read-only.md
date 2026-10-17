# Read-Only Studio (P1)

P1 provides a local source/entity/screen explorer, sanitized source-linked diagnostics,
projected OpenAPI/PostgreSQL/SQLite output, and a static synthetic UIDL preview. It does
not edit sources, execute business actions, apply SQL, install model packages, connect to
an identity provider/database, or expose the modeled business API.

## Launch a Local Build

Use Node 22.13 or newer. From the repository root on the Studio branch:

```sh
npm ci --ignore-scripts
npm run build
node packages/cli/dist/bin/kerangka.js studio packages/cli/test/fixtures/studio/approval.kerangka.json --port 8080
```

The default mount is `/studio/`, bound only to `127.0.0.1`. Open the **private launch link**
printed in the local terminal; its fragment contains the process/project capability.
Bare `/studio/` displays an access screen, not project data. The capability is not a
business role, cookie session, or tenant identity. Do not share the link or record it in
operational logs. No request log or API response contains it. The console does not put
it in localStorage; launch-link fragments remain available to that tab/history for reload
and expire when the host stops. A manually entered key is held only in memory.

Stop with Ctrl+C. Restart for another project or a new capability. A directory is accepted
when it has a canonical `kerangka.json/yaml/yml` entry or exactly one `*.kerangka` model;
choose an explicit model file if ambiguous. A custom mount is available with
`--studio-prefix /inspect`; this is configuration, not a second alias for the console.
Port `0` is supported for disposable test hosts.

This guide describes checked-out local code. It does not claim the command is already
published in a registry release or deployed anywhere.

## Inspect Without Changing Files

1. Select a source to read its exact JSON/YAML text. It is not normalized or saved.
2. Select an entity to inspect fields, computed/required metadata, operation roles, guards,
   and source pointers. These are model facts, not an authorization decision for Studio.
3. Select REST API or a SQL dialect to read generated output. Endpoints are not mounted
   and SQL is not applied.
4. Select a screen to view generated/authored UIDL or its admitted read-only preview.
5. Click a diagnostic to select the relative source and highlight its line where available.
   Fix the file externally and use Refresh source. Failed refresh explicitly retains a
   previous snapshot; it is not presented as a current successful build.

The desktop workbench and stacked narrow layout use the same source snapshot. Code is
a labelled, keyboard-scrollable text region, not raw HTML or a node per source line.
Unsupported selections/preview features have explicit source-only states; no source
construct is silently rewritten to make the preview work.

## Source and Inspection Boundaries

The project is selected by the local operator at launch. No HTTP path/query/header can
select another root. Discovery collects the entry, conventional model/UIDL/lock sources;
hidden/generated/dependency/non-source entries and nested independent Git repositories
are excluded and counted. Symlinks/hardlinks, unsupported portable paths, changing files,
invalid UTF-8, excess depth/count/bytes, and more than 10000 visited entries fail closed.
The host is intended for the tested POSIX profile, not a Windows filesystem certification.

Refreshes are coalesced to one job and cached by content revision for this host only.
They are snapshots, not a live filesystem watch or a transactional multi-file save.
Source writes, revision conflict resolution, undo/redo, and exports belong to later stages.

Inspection runs built trusted code in a separate process with a 5 s deadline, 128 MiB
V8 heap ceiling, bounded input/output, sanitized environment, and no filesystem-write or
child-process permissions. Filesystem reads are granted only to trusted code/dependency
roots; the project snapshot arrives over stdin. Compilation accepts a single document
and shipped official packs only. Workspace contexts and external/file/installed packages
are source-only with diagnostics, not automatically resolved. Lock text remains inspectable;
P1 is not a package/version resolver or reproducible release builder.

Node's permission model is not a general JavaScript/network sandbox. The profile never
loads user code, fetches schemas, installs packages, dispatches connectors, or runs engine
actions. Do not expand that accepted vocabulary without a separate security review.
Diagnostics expose relative pointers/codes/positions, not raw process errors, stderr,
absolute host paths, or stack traces.

## Preview Boundary

The real pinned `uidl-runtime@0.1.8` renderer runs in an opaque frame with both iframe
and response sandbox policy. The host uses public DocumentStateStore/DataAdapter seams,
not a duplicate renderer or fake successful mutation handler. List/form records are
generated presentation samples, not evaluated business records or permission evidence.

Only the admitted document and its referenced synthetic collections cross the bound
per-frame channel. Authoring capability, source bundle, unrelated sources, authored
state, recognized inline-data arrays, and event handlers are not sent. Other admitted
literal presentation values can still render; this is not an arbitrary-text secret
scanner or redaction system. The frame revalidates admission.
The host adapter refuses every create/update/remove/transition; no API, command, mutation,
or download capability is supplied. Controls are static/disabled. Business flows wait for
their separate engine/host/store gate.

The safe catalog includes bounded common layout/text/form/list/table/navigation components
and the standard recipe Popover. Images, URL/HTML/dynamic-tag props, reusable definitions,
component references, repeats, oversized structures, and unrecognized versions/features
remain source-only. This restricted profile is not an implementation of every proposed
UIDL envelope/capability feature or every native renderer.

CSP denies preview connect/image/font/frame/worker/object/form egress; only trusted built
scripts/styles are available. Opaque-frame modules use CORS on **public build assets only**.
The source API never enables wildcard CORS or accepts `Origin: null`. Message handling
requires the exact frame Window, nonce/channel, known vocabulary, and bounded values;
`null` alone is not trusted authority. Trusted runtime/registry/build code remains part
of the boundary; this is not a sandbox for arbitrary third-party JavaScript/plugins.

## Verification and Remaining Gates

```sh
npm run build
npm run verify
npm run test:conformance
PLAYWRIGHT_BROWSERS_PATH=0 npm exec playwright install chromium
npm run test:studio:e2e
npm audit
```

Browser binaries stay in ignored node_modules; synthetic screenshots/traces stay under
ignored `.local/studio-test-results`. CI installs Chromium in its disposable environment
and runs the same browser suite. A new remote CI result is not implied by local success.

Tests cover source confinement/limits, auth/Host/Origin/write rejection, actual launcher
and custom prefix, sanitized diagnostics, external-fix refresh, list/form rendering,
opaque parent-DOM denial, blocked local-sink fetch, ignored forged messages, preview reload,
unsupported network documents, keyboard navigation, color pairs, and 320px overflow.
The 50-entity/500-field/100-screen fixture passes functional inspection. That is not a
30-sample p95 latency, memory, full WCAG, general-race, or production isolation certification.

The optional repository PostgreSQL suite requires a dedicated disposable database through
`KERANGKA_POSTGRES_URL` and creates/drops tables. Do not point it at production/shared data.
Before writable/shared preview, independently prove verified sessions, role revocation,
cross-tenant same-ID isolation, scoped query/screen/action paths, discriminator handling,
idempotency, rollback, and concurrency against the actual selected store. P2+, hosted
access, migration, publication, and production readiness are not delivered by P1.
