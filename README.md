# Kerangka

**One JSON skeleton. Every stack.**

*Kerangka* (Indonesian for *skeleton* or *framework*) turns a declarative JSON model
into production application **logic** (validation, computed expressions, business rules,
workflows, actions, permissions) and **frontend** screens, running with identical semantics
across stacks.

```json
{
  "kerangka": "0.1",
  "app": "todo",
  "entities": {
    "Task": {
      "fields": {
        "title": "string!",
        "done": "bool = false",
        "due": "date"
      },
      "rules": [{ "id": "title-not-blank", "check": "len(trim(title)) > 0", "field": "title" }]
    }
  }
}
```

## Features

- **Sidecar Host Boundary:** The sidecar is the smallest honest host: a run's aggregates, events, and host effects commit together, events wait in an outbox until acknowledged, and a `call`, notification, or timer is queued for the host to perform rather than dropped. The store performs nothing itself — it cannot know what "delivered" means.
- **Durable Sessions:** `keranga serve --stdio --session <file>` keeps the session in SQLite, so a restarted sidecar still holds the events it promised to deliver and the effects nobody has performed. A commit is a transaction, so a crash leaves neither half. One sidecar owns a session file: a second one is refused with the process that holds it, a claim left behind by a crash is taken over, and a sidecar that has lost its claim is refused rather than allowed to write beside its replacement.
- **Pure Reference Engine:** Executes computations, rules, invariants, and state transitions deterministically without direct I/O.
- **Effective-Dated Rules:** A rate or fee that changes over time keeps its history: `versions` with `validFrom`/`validTo` on a rule or a decision table, the period chosen by the field the model names (PLAN.md §5.12). A record from 2026 is decided with the 2026 rules, and `keranga verify` reports periods that overlap, leave a gap, or are not oldest first.
- **Runtime Ports & Adapters:** Pluggable store contracts (`StorePort`, `CachePort`, `BusPort`, etc.) with out-of-the-box adapters for PostgreSQL and zero-dependency SQLite (Node 22 `node:sqlite`).
- **Declarative Projections:**
  - **JSON Schema 2020-12:** One definition per entity and per event payload, with `readOnly` on what the engine computes.
  - **OpenAPI 3.1 & REST API:** Generates comprehensive OpenAPI specifications and RFC 9457 Problem Details error schemas.
  - **GraphQL SDL:** Generates complete GraphQL schemas with queries, mutations, and filter inputs.
  - **Model Context Protocol (MCP):** Generates tool schemas for AI coding agents (`list_*`, `get_*`, `create_*`, `update_*`, `delete_*`, `transition_*`).
  - **UIDL Screens:** Co-evolved with [UIDL-Runtime](https://github.com/hi-donwi/UIDL-Runtime) to project declarative dashboards, tables, forms, and navigation shells directly into valid UIDL documents.
- **Zero-Config Dev Server:** Instant local server (`kerangka dev`) providing REST endpoints, MCP dispatch, and an interactive developer playground.
- **Cross-Platform Conformance:** Validated by language-neutral cross-platform test fixtures.

## CLI Usage

Install or run via `npx kerangka`:

```bash
# Check model syntax, types, and expression validity
kerangka check examples/invoicing.kerangka.json

# Report boundaries, naming rules, and complexity budgets
kerangka lint examples/invoicing.kerangka.json
kerangka lint examples/commerce --topology distributed --fail-on warning
kerangka lint examples/invoicing.kerangka.json --format json

# Compile model into canonical Intermediate Representation (KIR)
kerangka build examples/invoicing.kerangka.json -o build/invoicing.kir.json

# Generate SQL DDL for PostgreSQL or SQLite
kerangka ddl examples/invoicing.kerangka.json --dialect postgres -o schema.sql

# Generate OpenAPI 3.1 specification
kerangka openapi examples/invoicing.kerangka.json -o openapi.json

# Generate GraphQL SDL schema
kerangka graphql examples/invoicing.kerangka.json -o schema.graphql

# Generate Model Context Protocol (MCP) tool declarations
kerangka mcp examples/invoicing.kerangka.json -o mcp-tools.json

# Generate UIDL screen documents for UIDL-Runtime
kerangka uidl examples/invoicing.kerangka.json -o uidl-screens/

# Generate typed language models (TypeScript, Java 21, Python, Go)
kerangka codegen examples/invoicing.kerangka.json --target ts -o models.ts
kerangka codegen examples/invoicing.kerangka.json --target java -o Invoice.java
kerangka codegen examples/invoicing.kerangka.json --target python -o models.py
kerangka codegen examples/invoicing.kerangka.json --target go -o models.go

# Analyze breaking and structural changes between model versions
# Every contract the model publishes: entities, workflows, event payloads,
# policies, and actions — an event is what a consumer subscribes to, and an action
# is what a client may do (ADR-0032)
kerangka diff old.json new.json --check-breaking

# Generate production-ready Docker Compose infrastructure
kerangka compose examples/invoicing.kerangka.json -o docker-compose.yml

# Unified emission for any target
kerangka emit compose examples/invoicing.kerangka.json -o docker-compose.yml
kerangka emit openapi examples/invoicing.kerangka.json -o openapi.json
kerangka emit sql:postgres examples/invoicing.kerangka.json -o schema.sql

# The event contract a consumer subscribes to (AsyncAPI 3.0, CloudEvents payloads)
kerangka emit asyncapi examples/commerce -o asyncapi.json
kerangka emit asyncapi examples/invoicing.kerangka.json --broker nats --host events:4222

# The data shape and form contract (JSON Schema 2020-12): one definition per entity
# and per event payload, readOnly on what the engine computes
kerangka emit json-schema examples/invoicing.kerangka.json -o schema.json
kerangka emit json-schema examples/invoicing.kerangka.json --entity Invoice   # one form
kerangka emit json-schema examples/commerce --event OrderPlaced              # one payload

# Launch zero-config dev server with interactive playground
kerangka dev examples/invoicing.kerangka.json --port 3000
```

## Monorepo Packages & SDKs

| Package | Path | Description |
|---|---|---|
| `@kerangka/k1` | `packages/k1` | Pratt expression parser, exact decimal arithmetic, three-valued logic |
| `@kerangka/compiler` | `packages/compiler` | Shorthand expander, linter, DDL generator, JSON Schema, OpenAPI, AsyncAPI, GraphQL, MCP, UIDL, and Compose projections |
| `@kerangka/engine-ts` | `packages/engine-ts` | Pure reference execution engine in TypeScript |
| `@kerangka/ports` | `packages/ports` | 10 runtime port contracts and memory adapters |
| `@kerangka/client` | `packages/client` | Offline-first client runtime, mutation outbox, and action replay sync |
| `@kerangka/adapter-sqlite` | `packages/adapter-sqlite` | Native SQLite adapter using Node 22 `node:sqlite` |
| `@kerangka/adapter-postgres` | `packages/adapter-postgres` | Parameterized PostgreSQL query builder and store adapter |
| `@kerangka/server` | `packages/server` | Dev server with REST, MCP dispatcher, and UIDL playground |
| `kerangka` | `packages/cli` | Command-line developer interface |
| `conformance` | `conformance/` | Language-neutral cross-platform conformance fixtures |
| `sdk/go` | `sdk/go` | Go SDK with reference engine and `net/http` REST server adapter |
| `sdk/dart` | `sdk/dart` | Dart & Flutter SDK with pure reference engine |
| `sdk/python` | `sdk/python` | Python SDK with pure reference engine |
| `sdk/java` | `sdk/java` | Java 21 SDK scaffolding |

## Status

Phase 0 (Foundations), Phase 1 (Spec & Core Engine), Phase 2 (Ports & Adapters), Phase 3 (Projections, UIDL & Dev Server), Phase 4 (Multi-Language Codegen & Model Differ), and Phase 5 (Dart SDK, Offline Outbox, Go Server & Compose Emission) are completed. See [PLAN.md](PLAN.md) for the long-term roadmap.

## License

- Code: [Apache-2.0](LICENSE-APACHE)
- Specifications: [CC BY 4.0](LICENSE-CC-BY)
