# Studio Source-Bundle Contract 0.1

Status: Accepted CP0 baseline (2026-10-16). This is an authoring envelope, not a Kerangka model, UIDL document,
execution format, HTTP API, or authority grant. The checked-in
[JSON Schema](../../spec/studio/source-bundle.schema.json) is the structural contract.
No loader, saver, endpoint, or public package export is implemented by P0.

## Shape and Ownership

| Field | Meaning | Authority |
|---|---|---|
| `kind` | Exactly `kerangka.studio.source` | Distinguishes sources from compiled artifacts |
| `version` | Exactly `0.1` | Bundle contract version, independent of Kerangka/UIDL versions |
| `revision` | Nonempty opaque token, at most 128 ASCII identifier characters | Host-issued expected revision for a future draft operation; not a permission or build hash |
| `entry` | Relative JSON/YAML model source path | Must resolve to a source during semantic validation |
| `sources` | Map of relative path to `{ format, text }` | Author text is authoritative, including whitespace/comments and unsupported constructs |
| `application.pages` | Stable page ID to one exclusive ownership mode | Host authoring metadata, not extra keys inside a business model |
| `application.routes` | Ordered `{ id, path, page, access }` declarations | Navigation intent; the host resolves it and the backend still authorizes every operation |
| `application.preview` | Exactly `{ profile: "read", data: "synthetic" }` | Requested ceiling only; the host independently enforces read-only synthetic execution |
| `editor.positions` | Optional authoring-reference to `{ x, y }` map | Editor-only sidecar state; never compiled into business semantics |

`$schema` is optional and, when present, names this contract's fixed identifier. Schema
identifiers are names, not fetch instructions. P0 tests use a trusted local schema and
Ajv's synchronous compile API with no remote loader, coercion, default insertion, or
property removal. Unknown envelope keys and unrecognized versions are rejected rather
than silently ignored. Future format changes require an explicitly reviewed version;
there is no compatibility adapter for an unshipped Studio format.

The [positive fixture](../../packages/cli/test/fixtures/studio/source-bundle.valid.json)
contains a small model, a recipe-owned list, an authored help page, and their routes.
The [negative fixture](../../packages/cli/test/fixtures/studio/source-bundle.invalid.json)
combines an unsupported version, traversal path, and production/write preview request.
Tests isolate individual rejection cases in addition to checking that fixture.

## Sources and Paths

Source text stays a string; parsing belongs to the appropriate validator/compiler. An empty
or unfinished document can be retained as a draft, but cannot be compiled or rendered until
its later validation stages pass. Do not reconstruct text from KIR or a normalized document.

Version 0.1 accepts portable ASCII path segments beginning with an alphanumeric character,
underscore, or hyphen; the remaining characters may also contain dots. Paths are at most
240 characters and end in `.json`, `.yaml`, or `.yml`; root `kerangka.lock` is also allowed.
Paths are case-sensitive identifiers in the bundle. Absolute paths, URLs, backslashes,
encoded traversal, empty/dot segments, hidden paths, and `node_modules`, `dist`, `build`,
or `vendor` directory segments are not sources. This deliberately narrow transport subset
is not a promise to import every existing filesystem layout. Surface unsupported layouts
as diagnostics; never silently skip or rename files.

A path passing a regex is not filesystem authorization. Future loading must still confine
real paths and open handles to the chosen source root, reject symlink/race escapes and
case-folding aliases, reject duplicate JSON keys before they are lost by parsing, and
apply an explicit file allowlist. Do not use paths supplied by an imported bundle to
discover arbitrary local files. Windows device-name handling requires its own platform
proof before Windows filesystem support is claimed.

`format` is `json` or `yaml`. Semantic validation checks extension/content agreement;
authored `.uidl.json` and `kerangka.lock` are JSON. Lockfile text uses the existing Kerangka
lock contract and carries no new package authority. A package source in a model or lock
never authorizes a network install, Git operation, or out-of-root filesystem read.

JSON visual writes are the initial supported write path. YAML, package-owned declarations,
templates, and constructs without a verified edit mapping stay source-only/read-only in
visual mode. A source-preserving YAML operation must be proved before enabling that write
path. No edit may silently flatten templates or discard valid source it cannot understand.

## Pages and Routes

- Recipe page: `{ "mode": "recipe", "view": "requests" }`. The model view is the source;
  generated UIDL is read-only. Current Kerangka view kinds are list, form, and dashboard.
- Authored page: `{ "mode": "authored", "source": "pages/help.uidl.json" }`. The UIDL source
  is authoritative and must not be overwritten when another page regenerates.
- Materializing a recipe page as authored UIDL is an explicit ownership change with a diff,
  provenance, and a revision check, not a silent override of generated output.

Page/route IDs are lowercase identifiers, at most 64 characters, with reserved prototype
keys refused. Routes are canonical root-relative paths: `/`, static segments, and named
`:parameter` segments. No scheme, query, fragment, dot segment, or trailing/double slash is
accepted. Parameters are decoded strings in this version; coercion and richer parameter
types require a reviewed host contract, not an expression hidden inside a path.

Semantic validation must reject duplicate route IDs/paths, ambiguous patterns such as
`/requests/:id` versus `/requests/:name`, repeated parameter names, missing page targets,
and collisions with the configured Studio prefix or operational API/screen routes. The
regex alone does not prove any of these. Route `access` is `public` or `session` and affects
navigation UX only; it never grants a business role, exposes a record, or replaces server
authorization. Arbitrary custom REST handlers are not part of this route manifest.

P1/P3 may use routes derived by the existing projector without implementing a general
router. Full authored route behavior waits for the shared host-shell contract (UX-05).
Map to that accepted public contract later instead of building a competing routing engine.

## Validation Stages

| Stage | Required checks | May be claimed by P0? |
|---|---|---|
| Structurally valid draft | Envelope version, shape, lexical paths, ownership modes, local schema limits | Yes, for the checked fixtures and mutations |
| Resolved source graph | Entry exists; formats agree; contexts/packages/locks resolve inside policy; page/view/source targets and IDs resolve; routes do not collide | No runtime resolver is implemented here |
| Compilable | Existing model compiler, source structure/types/expressions, UIDL validation, registry support, and cross-reference diagnostics pass | Model fixture compiler checks only; not an end-to-end bundle build |
| Previewable | Host capability policy, synthetic adapter, frame isolation, denied egress/effects, resource limits, and permitted navigation pass | No browser or host proof in P0 |
| Releasable | Immutable build inputs/versions, tests, host/store proof, compatibility/migration review, and separate publication approval | No |

The transport schema intentionally cannot establish graph references or validate source
strings. Tests explicitly demonstrate that missing `entry` references and unfinished text
can be structurally accepted. Invalid drafts must remain visibly invalid; they are never
silently treated as a safe preview or successful build. A later resolver needs negative
tests for every semantic check in the table before it is enabled.

## Revisions, Save, and Build Identity

An imported revision is untrusted metadata. Opening an import must create a host-owned
draft identity; a save requires the expected revision to match the actual opened project
and source snapshot. Reject external edits as a recoverable conflict. Use atomic replacement
and preserve both versions; do not use last-writer-wins, a source-provided absolute path,
or the diagram's current state as permission to overwrite a file.

Editor positions reference authored symbols, not flattened KIR nodes. Keep them separate
from business content and define their inclusion explicitly in a future export operation.
An editor position change must not change engine behavior. Revision tokens are not
reproducible release hashes: current KIR includes `compiledAt`. Release identity must pin
source/lock/compiler/engine/projector/runtime/registry/target inputs and use the reviewed
deterministic compilation/compatibility contracts (KX-04/KX-10).

## Limits and Enforcement

The schema bounds sources to 128, each text to 524288 Unicode code points, pages/routes
to 100, editor positions to 2000, and coordinates to finite JSON numbers within
`[-1000000, 1000000]`. These are structural ceilings, not measured performance results.
Unicode character length is not a UTF-8 byte limit. Server-side byte, total-size, parser,
CPU, job, history, and browser budgets remain mandatory; see [security.md](security.md).

Rejecting a root field named `secrets` does not detect secrets embedded in otherwise valid
source text. Keep secrets outside sources, use host references, restrict exports/logging,
and do not send any private source to an AI provider without explicit authorization.
