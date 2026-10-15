# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versioning follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.1] - 2026-10-15

### Added
- Form views support validated `sectionTitles` in static and per-request screens. Static forms
  group fields with bounded widths, wide line-table support, and UIDL Runtime presentation hooks.
- Dashboards are served at `GET /screens/{viewId}` through UIDL-Runtime's dashboard recipe, with
  the caller's figures (ADR-0045 amendment). `Engine.kpiSource` and `Engine.kpiValue` compute a
  KPI with K1's own `count`, `sum`, and `avg` over the records its `where` admits; the server
  passes only the records the caller may read, leaves out a KPI over an entity the caller may not
  read, and shows no number for a KPI that cannot be evaluated.

### Changed
- `@kerangka/uidl-projector` requires `uidl-runtime` 0.1.8: the KPI `format` (0.1.7) and an
  install without React (0.1.8), so a server that compiles screens no longer installs React.
  The workspace keeps `react` and `react-dom` as development dependencies, for the tests that
  validate screens with the renderer's `DocumentSchema`.
- Screens compiled per request through UIDL recipes (ADR-0045). `@kerangka/uidl-projector` maps
  list and form views onto `uidl-runtime/recipes` (workflow transitions and input-free actions
  become buttons; `navigation` becomes a shell), and the server serves `GET /screens`,
  `GET /screens/{viewId}`, and `GET /screens/{viewId}/{id}`. A record screen carries the record's
  version and is served only when the actor may read that record.
- Entity templates and official packs (ADR-0043 amendment): `{ "use": "identity:member" }` at an
  entry of `entities` places a pack's entity under the document's own name.
  `@kerangka/identity` (organization, member) and `@kerangka/admin` (an append-only audit entry)
  ship with the compiler and load when named in `packages`. The `saas-auth` starter now uses
  `@kerangka/identity` instead of its own copy of the model.
- Starters are data under `packages/cli/starters/` (ADR-0043): `kerangka init --list` prints the
  catalog, and three new starters join the existing four: `api`, `dashboard`, and
  `admin-console`. Every starter carries declarative examples and passes the examples gate
  (`starters.test.ts`). `kerangka scaffold` builds from the `todo` starter's model.
- `saas-auth` starter: organizations and members with an invite-accept-suspend workflow,
  owner/admin/member permissions, and a role change only the owner may make. Checking
  credentials stays in the host adapter that produces the actor; the screens are UIDL-Runtime's
  `compileAuthPage` and `wrapInShell`.
- Template instances (ADR-0043): `{ "use": "std:approval", "with": { ... } }` at an entity's
  `workflow`, at an entry of its `actions`, or at an entry of `views` is expanded by the
  compiler. Arguments are checked against the template's `params`, keys beside `use` are merged
  as additions only, and the expansion goes through the same structural checks as hand-written
  input. `expandTemplate` in `@kerangka/std` is the one implementation of substitution.
- Polyglot multi-stack code generation targets in `@kerangka/compiler`:
  - Rust code generator emitting idiomatic types with `serde::{Serialize, Deserialize}`.
  - Dart code generator emitting null-safe immutable models with JSON serialization.
  - Go and Python code generators.
- Official Rust SDK (`sdk/rust/`):
  - `SidecarClient` for executing actions over stdio JSON-RPC.
  - `HttpClient` for executing actions over HTTP REST endpoints.
  - Strongly typed `ActionResult` and `Actor` domain structures.
- Polyglot end-to-end showcase (`examples/polyglot/`):
  - Canonical task management specification (`kerangka.json`).
  - Reference backends in Go, Python, and Rust.
  - Reference frontends in React and Flutter with UIDL screen definitions.
  - Docker Compose orchestration for cross-stack execution.

### Changed
- `kerangka init <name>` refuses an unknown starter and suggests the closest one, where it
  used to write the `workspace` starter silently. A workspace starter is written into a folder
  named after the app unless `--output` says otherwise, and the suggested next commands point
  at it.
- `std:approval` keys its transitions by name (`submit`, `approve`, `reject`) and
  `std:masterDetail` is a `list` view with `columns`, the shapes a model document uses. Neither
  could be used before, so no model changes meaning.
- `instantiateTemplate` returns only the expansion and throws when the arguments do not fit.
- `kerangka expand` prints `{ "entities", "views" }`, so an expanded view template is visible.

### Fixed
- **`kerangka serve` enforced no authorization** (ADR-0044 amendment). `KerangkaServer` checked no
  entity permission on REST or MCP, ignored read filters, let MCP create and update store
  unvalidated records, and ran an action from a caller with no actor as admin (or as any roles
  its body named). It now authorizes every path as the Hono adapter does; a request that names no
  actor holds no role, and acting without one is the `devActor` option `kerangka dev` sets.
- The Go, Python, and Dart engines fail closed where they used to fail open. None of them has an
  expression evaluator yet, so a transition with a guard ran as if the guard passed; it is now
  refused with `GUARD_UNSUPPORTED`. The Go REST server enforced no entity permissions, skipped
  read filters, and stored updates unvalidated; it now applies role lists and role maps
  (ADR-0044), answers 501 for a condition or a read filter it cannot evaluate, and validates the
  record an update would store. Their tests now run in CI.
- **Permissions written as a role map were not enforced** (ADR-0044). `canOperate` allowed any
  caller unless the operation's permission was a non-empty list, so
  `"update": { "admin": true, "billing": "status == 'draft'" }` let every role update, and an
  empty list let every role through. A role map now grants `true` roles and decides string
  conditions against the record (the stored one for update and delete); an empty list grants no
  one; a list endpoint refuses a conditional read and points at `readFilter`. `false` is
  accepted in a role map, as the structural layer's message always said.
- A named query's `where` written as text is lowered to the tuple form, as a `readFilter` is.
  It used to reach the store as a string, which the REST evaluator skipped, so the query
  answered with every row. A `where` no store can evaluate is `QUERY_WHERE_INVALID`.
- A view must be a `dashboard`, a `list`, or a `form` (`VIEW_KIND_MISSING`,
  `VIEW_KIND_CONFLICT`), and unknown view keys are reported. `examples/todo` and
  `examples/polyglot` declared `{ "type": "list", "entity": ... }`, which the projector never
  read, so those views had produced no screen; both now use `"list"`.
- The engine reads a decimal in its wire form. A decimal field sent as a JSON string
  (`"150.00"`, PLAN.md §9.1) reached K1 as a string: `price > 0` was false, so guards failed
  closed on every spec-encoded record, and `>= 0` never ran, so constraints failed open. Records
  and action inputs are now decoded by declared type, embedded lines and value types included,
  and a decimal field holding a non-number is `INVALID_DECIMAL`. Four conformance cases cover it.
- Package templates were registered and locked but never expanded, so no model could use one.
- The `commerce` starter's policies ran `Invoice.create` and `Reservation.create`, which it
  never declared, so a freshly initialised project failed `kerangka verify`.

## [0.1.0] - 2026-10-11

### Added
- Core declarative specification model (`@kerangka/k1`) supporting entities, fields, actions, rules, events, and workflows.
- Multi-target compiler (`@kerangka/compiler`) emitting JSON Schema, AsyncAPI, OpenAPI, PostgreSQL DDL, and SQLite DDL.
- TypeScript evaluation engine (`@kerangka/engine-ts`) with state transition checks, decision table execution, temporal effective dating, and event timers.
- Storage adapters for SQLite (`@kerangka/adapter-sqlite`) and PostgreSQL (`@kerangka/adapter-postgres`) with predicate pushdown.
- Transactional outbox bus (`@kerangka/ports`).
- CLI tool (`kerangka`) with `check`, `verify`, `run`, `serve`, `diff`, and decision CSV import/export commands.
- Standalone sidecar HTTP and JSON-RPC daemon (`@kerangka/server`).
- Conformance test harness and automated verification gates.
