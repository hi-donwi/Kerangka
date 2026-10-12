# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versioning follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
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
- `std:approval` keys its transitions by name (`submit`, `approve`, `reject`) and
  `std:masterDetail` is a `list` view with `columns`, the shapes a model document uses. Neither
  could be used before, so no model changes meaning.
- `instantiateTemplate` returns only the expansion and throws when the arguments do not fit.
- `kerangka expand` prints `{ "entities", "views" }`, so an expanded view template is visible.

### Fixed
- Package templates were registered and locked but never expanded, so no model could use one.

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
