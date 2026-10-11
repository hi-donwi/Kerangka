# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versioning follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
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
