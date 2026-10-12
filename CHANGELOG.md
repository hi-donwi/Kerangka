# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versioning follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
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
