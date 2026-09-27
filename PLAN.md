# Kerangka — Project Plan

> **Status:** Proposal; name accepted 2026-09-27 · **Written:** 2026-09-27 · **Targets:** spec 0.1 → 1.0

Kerangka is a specification and a family of SDKs that turn small JSON documents into
working application **logic** (data validation, computed values, business rules, actions,
workflows, permissions) and **frontend** screens, in every tech stack, with identical
behaviour everywhere. It is modular by design: bounded contexts, reusable packages, and
the same model deployed as a modular monolith or as microservices. The ambition: an open
standard for building software, by hand or with AI, from a small tool to a very large and
very complex system (§2).

## Contents

1. [Name](#1-name)
2. [What Kerangka is](#2-what-kerangka-is)
3. [Goals and non-goals](#3-goals-and-non-goals)
4. [Relationship to UIDL](#4-relationship-to-uidl)
5. [The document](#5-the-document)
6. [Architecture](#6-architecture)
7. [Modularity, reuse, and scale](#7-modularity-reuse-and-scale)
8. [State, storage, and APIs](#8-state-storage-and-apis)
9. [Semantics that must be identical everywhere](#9-semantics-that-must-be-identical-everywhere)
10. [Runtime API](#10-runtime-api)
11. [Tech stack coverage](#11-tech-stack-coverage)
12. [Frontend strategy](#12-frontend-strategy)
13. [Tooling, learning, and AI authoring](#13-tooling-learning-and-ai-authoring)
14. [Conformance suite](#14-conformance-suite)
15. [Repository layout](#15-repository-layout)
16. [Packaging and distribution](#16-packaging-and-distribution)
17. [Security model](#17-security-model)
18. [Versioning, governance, and the path to a standard](#18-versioning-governance-and-the-path-to-a-standard)
19. [Roadmap](#19-roadmap)
20. [Success metrics](#20-success-metrics)
21. [Risks and mitigations](#21-risks-and-mitigations)
22. [Decisions to record as ADRs](#22-decisions-to-record-as-adrs)
23. [First ten tasks](#23-first-ten-tasks)
- [Appendix A — Prior art](#appendix-a--prior-art)
- [Appendix B — Glossary](#appendix-b--glossary)

---

## 1. Name

**Kerangka** — Indonesian for *framework, skeleton, frame* (pronounced *keh-RAHNG-kah*).

The JSON document is the skeleton of an application: its data, rules, workflows,
permissions, and screens. Each tech stack puts the flesh on it. The word literally means
"framework", it is short, it is pronounceable in English, and it is unused as a package
name.

**Tagline:** *One JSON skeleton. Every stack.*

**Decision:** the owner accepted the name on 2026-09-27. The comparison below is kept as
the record of that decision.

| Artifact | Name |
|---|---|
| Project and brand | Kerangka |
| Authoring document | `*.kerangka.json` |
| Compiled canonical IR | `*.kir.json` |
| CLI | `kerangka` |
| Version key in a document | `"kerangka": "0.1"` |

### Name availability (checked 2026-09-27)

| Registry | `kerangka` |
|---|---|
| npm | free |
| PyPI | free |
| crates.io | free |
| pub.dev | free |
| NuGet | free |
| RubyGems | free |
| Maven Central (artifactId) | no artifact found |
| GitHub organisation | free |

Not checked: the npm organisation scope `@kerangka`, Packagist, and domain names.
**Reserve the name on every registry in Phase 0**, before any public announcement.

### Why JSON is not in the name

Standards named after JSON are standards *about* JSON: JSON Schema, JSON Patch, JSON-LD,
JSON:API. Kerangka *uses* JSON; its value is one model that becomes logic and UI in every
stack. Standards of that kind name the idea, not the encoding: OpenAPI, AsyncAPI,
GraphQL, Smithy, TypeSpec. A `json*` name would also be hard to search (generic JSON
results dominate), could be read as part of the official JSON Schema family, and would
become inaccurate if YAML authoring is ever accepted, as OpenAPI accepts it.

JSON still appears everywhere it helps people and search engines find the project:

| Where | How |
|---|---|
| Descriptor | "Kerangka — the JSON standard for application logic and UI" |
| Tagline | "One JSON skeleton. Every stack." |
| File name | `app.kerangka.json`, with `$schema` for editor autocomplete |
| Discovery | Package keywords and GitHub topics: `json`, `json-schema`, `low-code`, `codegen` |

### Naming structure

A standard, its UI layer, and its publisher are named separately, so each can grow
without renaming the others.

| Layer | Name | Role |
|---|---|---|
| Standard and SDKs | **Kerangka** | The JSON Schema standard for logic and UI, its compiler, engines, and adapters |
| UI layer | **UIDL** | The presentation format Kerangka emits and the runtimes that render it |
| Publisher | **donwi** (GitHub `hi-donwi`) | Author and maintainer: "Kerangka, by donwi" |

### Alternatives considered

| Name | Meaning | Why it is not first choice |
|---|---|---|
| donwi-code | The author's brand plus "code" | A standard others adopt needs a neutral name (Swagger became OpenAPI for this reason); "code" misdescribes a JSON-first standard and collides with editor names such as VS Code. Keep *donwi* as the publisher instead. |
| uidl-code | UIDL plus "code" | "UI" hides the main new value, which is logic; and TeleportHQ's active "UIDL Standard" already turns JSON UI descriptions into React, Vue, and Web Components code, so the name describes their product |
| JSONBone | English for what *kerangka* means: JSON as the skeleton | The only clean `json*` name found: free on npm, PyPI, crates.io, pub.dev, NuGet, RubyGems, Maven Central, with no GitHub account or repository of that name. But see "Why JSON is not in the name" below; also reads as a pun ("JSON Bourne") and "bone" has an English slang meaning |
| jsonstack, jsonflow, jsonscript, jsonkit, jsonframe, jsonapp, jsonspec, jsonweave | Various | Taken on at least one registry or as a GitHub account, or crowded (`jsonspec` already means "a spec for JSON data"; "weave" is crowded in AI tooling) |
| AppDL | "Application Definition Language", a sibling of UIDL | Free on npm, PyPI, crates.io, pub.dev; but generic, hard to search, and reads as "app download" |
| Rangkai | Indonesian: "to assemble, to string together" | Also free everywhere; weaker link to "framework" |
| Polyspec | "One spec, many languages" | Descriptive but generic; taken on RubyGems |
| Rangka | Indonesian: "frame" | Taken on npm |
| Tessera | A mosaic tile | Taken on every registry |

---

## 2. What Kerangka is

One JSON document describes an application's **model**. Kerangka turns it into two faces:

- **Logic.** Types and validation, computed fields, business rules, actions, state-machine
  workflows, and permissions, executed by a small deterministic **engine** that exists
  natively in many languages. The engine is pure: it returns a result and a list of
  *effects*, and the host performs I/O.
- **Frontend.** Screens (lists, forms, detail pages, dashboards) emitted as **UIDL
  documents**, rendered by the existing UIDL runtimes on web (React), Flutter, and
  Android. The same validation rules run in the client for instant feedback.

The same document gives the same answer in every language. That promise is enforced by a
language-neutral **conformance suite**, not by convention.

**North star:** someone who knows only JSON can build software with complex logic that
scales. Two metrics hold the plan to it (§20): at least 90% of the reference applications
need no host code, and a learner who knows only JSON builds the invoicing application in one
day.

### Vision: an open standard for building software

The long-term ambition is for Kerangka to become an **open standard for describing
software**: the way a product's data, rules, workflows, permissions, and screens are written
down, whoever writes them and whatever stack runs them.

- **With and without AI, as equals.** A person can write, read, and review every document
  by hand; AI assistants can generate and change the same documents. No feature requires AI
  (ADR-0026): AI makes Kerangka faster, never necessary.
- **The safe target for AI-generated software.** Code written by AI is hard to check. A
  Kerangka document written by AI is validated by its schema, checked by `kerangka verify`,
  tested by its examples, and reviewed as a small JSON diff together with its contract
  changes. That makes Kerangka the format AI assistants *should* produce, not only one they
  can.
- **A standard needs more than one implementation.** The path from one maintainer's
  specification to a neutrally governed standard is in §18.

**From tiny to very large, on one model:**

| Size | Shape | What Kerangka provides |
|---|---|---|
| Small | One file, one service, one database (Starter profile) | Single-file documents, scaffolded screens |
| Medium | A few contexts, one team, a modular monolith (Standard profile) | Contexts, packages, Redis/Valkey |
| Large | Dozens of contexts, many teams, microservices on several stacks (Distributed profile) | Exports, contracts, `kerangka diff`, deployment topologies, organisation standards |
| Very large and very complex | Hundreds of aggregates, regulated domains, many tenants | Decision tables with effective dates, human tasks, relationship-based permissions, privacy by model, audit, simulation |

Moving from one row to the next never requires a rewrite: files split into contexts (§7),
and infrastructure changes by configuration (§8).

### Who it is for

1. **AI agents** that generate working applications from a brief. They emit JSON that a
   published schema constrains, receive machine-readable errors, and repair.
2. **Teams building metadata-driven software** (ERP, back office, internal tools), where
   screens and rules change more often than code.
3. **Polyglot teams** that need the same business rules on a Java backend, a TypeScript web
   client, and a Flutter app, without writing them three times.
4. **Teams growing a large system** that want DDD boundaries, reusable building blocks, and
   the option to split a modular monolith into microservices without rewriting the model
   (§7).

---

## 3. Goals and non-goals

### Goals

| # | Goal | Measured by |
|---|---|---|
| G1 | **Simple to write.** A useful app fits in under 100 lines. Shorthand covers common cases, and every shorthand has an explicit object form. | Example sizes (§20) |
| G2 | **Same semantics everywhere.** Numbers, dates, strings, nulls, ordering, and errors are specified. | 100% conformance per certified engine |
| G3 | **Every stack can use it on day one**, before a native engine exists, through a sidecar and standard contracts. | Sidecar + OpenAPI at v0.2 |
| G4 | **Pure, embeddable engine.** No I/O, no global state, no network, no clock of its own. | Engine API has no I/O parameters |
| G5 | **Safe with untrusted documents.** Bounded evaluation, no code execution, fail-closed checks. | Security tests in conformance |
| G6 | **AI-first authoring.** Schema for structured output, error codes with repair hints, an MCP server. | LLM eval scores (§20) |
| G7 | **An escape hatch, not a bigger language.** What the document cannot express goes to named host handlers. | Feature admission rule (§18) |
| G8 | **Modular and reusable at scale.** Bounded contexts, aggregates, traits, templates, and packages; boundaries enforced by the compiler; one model deployable as a monolith or as microservices. | Monolith-to-microservices split with zero model changes (§20) |
| G9 | **Easy to work on.** Small files, scaffolding, complexity budgets, per-context tests, one-command local run. | Lint budgets hold on every example (§20) |
| G10 | **JSON is enough for most business software.** Decision tables, schedules and timers, and connectors cover what usually forces code; explain, verify, and a learning path make complex logic understandable. | North-star metrics (§20) |
| G11 | **Any storage, any API, same rules.** Databases, caches such as Redis, brokers, REST, GraphQL, and MCP are adapters and projections of one model (§8). | API parity conformance; adapter test kits |
| G12 | **With and without AI.** Every feature is usable by hand; AI assistants accelerate but are never required. | ADR-0026; every tutorial level completed without AI |
| G13 | **A standard, not only a product.** Open spec, public RFCs, independent implementations, a path to neutral governance. | Stages in §18 |
| G14 | **Zero-downtime evolution and ironclad invariants.** Changes never break running production instances; domain invariants hold mathematically. | ADR-0029, ADR-0032 |

### Non-goals

- **A Turing-complete language.** No loops beyond bounded list aggregates, no recursion,
  and no functions beyond non-recursive named expressions (`defs`) that the compiler
  inlines. Termination is guaranteed.
- **Infrastructure.** Kerangka does not run message brokers, service meshes, or
  databases; adapters connect to the ones you already use.
- **A database or ORM.** Kerangka emits persistence *effects* and optional DDL; adapters own
  storage.
- **A hosted platform or BaaS** through 1.0 (a hosted offering is a Horizon 3 option, §19).
- **A second UI language.** Frontend output is UIDL.
- **A full visual editor** through 1.0; the decision-table grid in the playground is the one
  exception. Kerangka Studio is a Horizon 3 item (§19).
- **Replacing ordinary code.** Complex integrations, heavy algorithms, and I/O stay in host
  code behind extension handlers.

---

## 4. Relationship to UIDL

[UIDL](https://github.com/hi-donwi/UIDL-Runtime) (UI Document Language) already exists and
is Kerangka's foundation for the frontend:

- UIDL describes **presentation**: layout, UI state, bindings, events, and UI actions.
  Runtimes exist for React (npm `uidl-runtime`), Flutter (pub `uidl_flutter`), and
  Android, and they share a conformance suite.
- UIDL deliberately owns **no business rules**. Writes leave the document through `mutate`
  (`create | update | delete | transition`) and `command` actions, which call a
  host-supplied handler.

Kerangka fills exactly that gap. **Kerangka never renders; UIDL never decides a business
outcome.**

| Concern | Owner |
|---|---|
| Entities, fields, validation | Kerangka |
| Computed values, business rules | Kerangka |
| Actions, workflows, permission *enforcement* | Kerangka |
| Screens, layout, UI state, navigation | UIDL, generated from Kerangka `views` |
| Domain cache, drafts, optimistic updates, offline data | Kerangka client (§8.2, §8.3) |
| Permission *gating* in the UI (cosmetic) | UIDL, generated from Kerangka permissions |
| Rendering | UIDL runtimes |
| I/O, persistence, authentication | The host application, through Kerangka adapters |

### Integration points

1. **Projector.** Kerangka `views` compile to UIDL documents (§12).
2. **Handler bridge.** The UIDL host's mutation and command handler calls Kerangka:

   | UIDL action | Kerangka call |
   |---|---|
   | `mutate` `create` / `update` / `delete` on `Invoice` | `run("Invoice.create" / "Invoice.update" / "Invoice.delete")` |
   | `mutate` `transition` `send` on `Invoice` | `run("Invoice.send")` |
   | `command` `applyDiscount` | `run("Invoice.applyDiscount")` |
   | `query` data source | A named Kerangka `query`, executed by the adapter through `queryPlan` with `readFilter` applied |

   Kerangka errors map onto UIDL's `errorPath` and `fieldErrorsPath`; the optimistic
   `version` travels in both directions.
3. **One expression language.** Kerangka's canonical expression AST *is* the UIDL
   expression grammar (Approved for UIDL spec 1.x) plus a small extension set (§9.4). The
   extensions are proposed upstream as an additive UIDL minor version, so UI and logic
   never evaluate expressions differently.
4. **One conformance style.** The same case shape (`id`, `class`, `input`, `context`,
   `expected`); UIDL's expression cases are imported unchanged.

### Co-evolution and direct adjustment of UIDL-Runtime

[UIDL-Runtime](https://github.com/hi-donwi/UIDL-Runtime) (developed as a sibling repository
in this workspace under `projects/donwi/public/UIDL-Runtime`) is the direct presentation layer
implementation for Kerangka.

- **Direct adjustability:** UIDL-Runtime is under the same stewardship (`donwi`). It is not an
  immutable third-party black box, but is actively co-developed, adjusted, and expanded to support
  Kerangka's requirements.
- **Upstream evolution loop:** Whenever Kerangka requires presentation capabilities:
  1. **Expression grammar:** K1 extension operators (`mod`, `neg`, `concat`, etc.) are directly
     merged into the UIDL expression evaluator and conformance suite.
  2. **Data & Action bridges:** UIDL's `DataAdapter` and action dispatcher are adjusted to support
     Kerangka's streaming SSE, optimistic updates with rollback, error path taxonomy, and
     offline action queuing.
  3. **Components & Views:** UIDL's standard document definitions and templates are expanded to
     natively render Kerangka's generated inbox, human task assignment views, decision table
     grid editors, and dashboard widgets.
  4. **Multi-target parity:** As Kerangka expands from web (React) to mobile (Flutter, Android),
     the corresponding `UIDL-Runtime` targets (`runtime-flutter`, `runtime-android`) are updated
     in tandem.
- **Zero-drift contract:** Both repositories run against shared conformance cases for expressions
  and document schemas, guaranteeing that any adjustment in UIDL-Runtime preserves total
  compatibility with Kerangka's IR and emitted UIDL documents.

---

## 5. The document

### 5.1 A complete example

A small invoicing application in one file: three entities, a computed total, a rule,
row-level permissions, a three-step workflow, an event, a host integration, three screens,
and a test. This single-file form is the quick start; larger applications split the same
content into contexts and files (§7.3) without changing its meaning.

```json
{
  "kerangka": "0.1",
  "app": "invoicing",
  "meta": { "title": "Invoicing", "timezone": "Asia/Jakarta" },
  "roles": ["admin", "billing", "viewer"],

  "entities": {
    "Customer": {
      "fields": {
        "name": "string!",
        "email": "email!",
        "creditLimit": "decimal(12,2) >= 0 = 0"
      }
    },

    "Invoice": {
      "fields": {
        "number": "string! unique",
        "customer": "ref(Customer)!",
        "issuedOn": "date! = today()",
        "dueDate": "date!",
        "lines": "list(Line)",
        "status": "enum(draft, sent, paid, void) = draft",
        "paidAt": "datetime",
        "total": { "type": "decimal(12,2)", "compute": "sum(lines, qty * unitPrice)" }
      },
      "rules": [
        { "id": "due-after-issue", "check": "dueDate >= issuedOn", "field": "dueDate",
          "message": "Due date cannot be before the issue date" }
      ],
      "permissions": {
        "read": ["admin", "billing", "viewer"],
        "create": ["admin", "billing"],
        "update": { "admin": true, "billing": "status == 'draft'" },
        "delete": ["admin"]
      },
      "workflow": {
        "field": "status",
        "transitions": {
          "send": { "from": "draft", "to": "sent", "roles": ["billing"],
                    "when": "count(lines) > 0 && total > 0",
                    "then": [{ "emit": "InvoiceSent", "data": { "invoice": "id" } },
                             { "call": "sendInvoiceEmail", "with": { "invoice": "id" } }] },
          "pay":  { "from": "sent", "to": "paid", "roles": ["billing"],
                    "then": [{ "set": { "paidAt": "now()" } }] },
          "void": { "from": ["draft", "sent"], "to": "void", "roles": ["admin"] }
        }
      }
    },

    "Line": {
      "embedded": true,
      "fields": {
        "description": "string!",
        "qty": "int! >= 1",
        "unitPrice": "decimal(12,2)! >= 0"
      }
    }
  },

  "events": {
    "InvoiceSent": { "invoice": "ref(Invoice)!" }
  },

  "extensions": {
    "sendInvoiceEmail": { "input": { "invoice": "ref(Invoice)!" }, "mode": "after-commit" }
  },

  "views": {
    "home": { "dashboard": [
      { "kpi": "Outstanding", "sum": "Invoice.total", "where": "status == 'sent'" },
      { "kpi": "Overdue", "count": "Invoice", "where": "status == 'sent' && dueDate < today()" }
    ] },
    "invoices": { "list": "Invoice", "columns": ["number", "customer.name", "dueDate", "total", "status"],
                  "filters": ["status"], "open": "invoice" },
    "invoice": { "form": "Invoice", "actions": ["send", "pay", "void"],
                 "sections": [["number", "customer", "issuedOn", "dueDate"], ["lines"], ["total", "status"]] }
  },
  "navigation": ["home", "invoices"],

  "examples": [
    { "name": "an empty invoice cannot be sent",
      "run": "Invoice.send",
      "record": { "status": "draft", "lines": [] },
      "actor": { "roles": ["billing"] },
      "expect": { "ok": false, "error": "GUARD_FAILED" } }
  ]
}
```

### 5.2 What that document produces

| Output | Detail |
|---|---|
| Validation | For `Customer`, `Invoice`, and `Line`, identical in the browser, on mobile, and on the server |
| Computed field | `total`, computed with exact decimal arithmetic in every language |
| Actions | Implicit `create` / `update` / `delete`, plus workflow transitions `send`, `pay`, `void` with guards, roles, and effects |
| Permissions | Role checks and a row-level condition (`billing` may only update drafts) |
| Contracts | JSON Schema per entity; OpenAPI 3.1 for `GET/POST /invoices`, `GET/PATCH/DELETE /invoices/{id}`, `POST /invoices/{id}/send`, …; optional PostgreSQL DDL |
| Frontend | Three UIDL documents (`home`, `invoices`, `invoice`) and a navigation shell |
| Tests | The `examples` entry runs under `kerangka test` and in CI |

### 5.3 Top-level keys

| Key | Purpose | Phase |
|---|---|---|
| `kerangka` | Spec version the document is written against (required) | 1 |
| `app` | Application id (kebab-case) | 1 |
| `meta` | Title, description, `timezone`, default locale | 1 |
| `types` | Reusable named types: enums, value objects such as `Money` or `Address` | 1 |
| `entities` | Records: fields, rules, permissions, actions, workflow | 1–2 |
| `traits` | Reusable bundles of fields, rules, defaults, read filters, and permissions (§7.5) | 1 |
| `invariants` | Aggregate-level integrity assertions that hold across all states (§5.13) | 2 |
| `multitenancy` | First-class tenant isolation strategy: discriminator, schema, or db (§5.14) | 2 |
| `defs` | Named pure expressions: predicates and calculations (§7.5) | 1 |
| `examples` | Executable tests | 1 |
| `roles` | Role names used by permissions and guards | 2 |
| `events` | Domain events with typed payloads | 2 |
| `policies` | Reactions: when an event happens, run an action (§7.3) | 2 |
| `queries` | Named, paginated reads used by views and APIs | 2 |
| `extensions` | Host handlers and connectors the document may call, with typed input and output (§5.10) | 2 |
| `decisions` | Decision tables (§5.8) | 2 |
| `schedules` | Recurring actions (§5.9) | 2 |
| `client` | Draft persistence, real-time, and offline settings (§8.3) | 3 |
| `tasks` (inside a workflow) | Human tasks, assignment, SLAs (§5.11) | 5 |
| `views`, `navigation` | Frontend projection | 3 |
| `seed` | Sample data for `kerangka dev` | 3 |
| `messages` | Message catalogue for i18n | 5 |

Multi-file applications use a workspace manifest (`kerangka.json`), context files
(`context`, `exports`, `dependsOn`, `glossary`), aggregate files, packages, and a
deployment file. They are specified in Phase 1 and built in Phases 1–2 (§7, §19), because
modularity shapes the IR and cannot be added later.

Entity keys: `fields`, `key` (identity; default `id: uuid`), `rules`, `permissions`,
`actions`, `workflow`, `embedded` (no identity, lives inside a parent), `audit`
(`createdAt`, `updatedAt`, `createdBy`, `updatedBy`), and `version` (optimistic
concurrency, on by default), plus `storage` and `indexes` for database mapping (§8.4).
Fields may be marked `sensitive` (never cached or stored offline), `personal` (personal
data: masked in logs and traces, recorded in the audit trail, later exportable and
erasable), or carry `renamedFrom` (migrations). Rules and decision tables may carry
`versions` with `validFrom` and `validTo` (§5.12). Every non-embedded entity gets implicit `create`, `update`,
and `delete` actions, subject to its permissions.

### 5.4 Shorthand and object form

Shorthand exists to keep documents short for people and LLMs. Its grammar is deliberately
tiny: a type, `!` for required, at most one lower and one upper bound (`> >= < <=`),
`= default`, and `unique`.
Everything else uses the object form. The two forms may be mixed, and
`kerangka expand` prints the object form of any document.

| Shorthand | Object form |
|---|---|
| `"string!"` | `{"type": "string", "required": true}` |
| `"string! unique"` | `{"type": "string", "required": true, "unique": true}` |
| `"int! >= 1"` | `{"type": "int", "required": true, "min": 1}` |
| `"decimal(5,2)! > 0 <= 50"` | `{"type": "decimal", "precision": 5, "scale": 2, "required": true, "exclusiveMin": "0", "max": "50"}` |
| `"decimal(12,2) >= 0 = 0"` | `{"type": "decimal", "precision": 12, "scale": 2, "min": "0", "default": "0.00"}` |
| `"enum(draft, sent) = draft"` | `{"type": "enum", "values": ["draft", "sent"], "default": "draft"}` |
| `"ref(Customer)!"` | `{"type": "ref", "entity": "Customer", "required": true}` |
| `"list(Line)"` | `{"type": "list", "of": "Line"}` |
| `"date! = today()"` | `{"type": "date", "required": true, "default": {"$expr": "today()"}}` |

Mixed form, for anything beyond the shorthand:

```json
"number": { "type": "string!", "label": "Invoice number", "pattern": "^INV-[0-9]{6}$",
            "help": "Assigned on creation" }
```

### 5.5 Expressions as strings

Authors write expressions as short infix strings. The compiler parses them into the
canonical JSON AST; engines only ever see the AST.

```
expr   := or
or     := and  { ("||" | "or")  and }
and    := cmp  { ("&&" | "and") cmp }
cmp    := coal [ ("==" | "!=" | ">" | ">=" | "<" | "<=" | "in") coal ]
coal   := add  { "??" add }
add    := mul  { ("+" | "-") mul }
mul    := unary { ("*" | "/" | "%") unary }
unary  := [ "!" | "not" | "-" ] atom
atom   := number | 'string' | true | false | null | path | call | "(" expr ")"
path   := ident { "." ident }
call   := ident "(" [ expr { "," expr } ] ")"
```

`"count(lines) > 0 && total > 0"` compiles to:

```json
{ "op": "and",
  "left":  { "op": "gt", "left": { "agg": "count", "over": "record.lines" }, "right": 0 },
  "right": { "op": "gt", "num": "decimal",
             "left": { "$bind": "record.total" }, "right": { "literal": "0" } } }
```

Name resolution:

- A bare name refers to a field of the current record (`total` → `record.total`).
- `input.*`, `actor.*`, `uses.*`, and `ctx.*` are explicit.
- Inside a per-row aggregate such as `sum(lines, qty * unitPrice)`, bare names refer to
  the row; `record.<field>` reaches the outer record.

### 5.6 Actions

Custom actions sit beside the implicit CRUD actions and the workflow transitions. This one
assumes `Invoice` also declares `"discount": "decimal(12,2) >= 0 = 0"`:

```json
"actions": {
  "applyDiscount": {
    "input": { "percent": "decimal(5,2)! > 0 <= 50" },
    "roles": ["billing"],
    "when": "status == 'draft'",
    "do": [{ "set": { "discount": "round(total * input.percent / 100, 2)" } }]
  }
}
```

The statement vocabulary is fixed and small:

| Statement | Meaning |
|---|---|
| `{"set": {"<field>": <expr>}}` | Assign fields on the target record |
| `{"append": {"<list>": <expr>}}`, `{"remove": {"<list>": <expr>}}` | Change an embedded list |
| `{"create": {"entity": "X", "values": {…}}}` | Create a new aggregate in the same context (a `persist` effect). Existing aggregates other than the target change only through events and policies (§7.4) |
| `{"transition": "<name>"}` | Run a workflow transition |
| `{"emit": "<Event>", "data": {…}}` | Raise a declared domain event |
| `{"call": "<extension>", "with": {…}}` | Ask the host to run a registered handler |
| `{"fail": {"code": "…", "message": "…"}}` | Abort with an error |
| `{"if": <expr>, "then": [...], "else": [...]}` | Branch |

**Data from outside the record.** An action that needs another record or an external value
declares it in `uses`:

```json
"send": { "from": "draft", "to": "sent",
          "uses": { "customer": "load(customer)" },
          "when": "total <= uses.customer.creditLimit" }
```

The host asks the engine what it needs (`plan`), loads it, and passes it into `run`. This
two-step protocol keeps the engine free of I/O.

### 5.7 The result of an action

```json
{
  "ok": true,
  "record": { "…": "the full record after the action, computed fields included" },
  "patch": [{ "op": "replace", "path": "/status", "value": "sent" }],
  "effects": [
    { "kind": "persist", "op": "update", "entity": "Invoice", "id": "…", "expectedVersion": 3 },
    { "kind": "emit", "event": "InvoiceSent", "data": { "invoice": "…" } },
    { "kind": "call", "extension": "sendInvoiceEmail", "mode": "after-commit",
      "input": { "invoice": "…" } }
  ],
  "errors": []
}
```

On failure nothing is applied, and every error found is reported:

```json
{ "ok": false,
  "errors": [{ "code": "RULE_FAILED", "rule": "due-after-issue", "path": "/dueDate",
               "message": "Due date cannot be before the issue date" }] }
```

`patch` is RFC 6902 JSON Patch. Other effect kinds are `timer` and `cancel-timer` (§5.9).

### 5.8 Decision tables

Complex business rules — prices, fees, discounts, taxes, eligibility, approval routing — are
easier to write, read, and review as a table than as nested conditions, and people who are
not programmers already know tables from spreadsheets. Kerangka adopts a small subset of
DMN-style decision tables.

```json
"decisions": {
  "shippingFee": {
    "inputs": { "destination": "enum(domestic, international)", "weightKg": "decimal(8,2)" },
    "output": "decimal(12,2)",
    "hit": "first",
    "rows": [
      { "destination": "domestic",      "weightKg": "<= 1", "result": "15000" },
      { "destination": "domestic",      "weightKg": "> 1",  "result": "15000 + (weightKg - 1) * 5000" },
      { "destination": "international", "weightKg": "any",  "result": "250000" }
    ]
  }
}
```

A decision is called like a function, with its inputs in declared order:
`"fee": { "type": "decimal(12,2)", "compute": "shippingFee(destination, totalWeight)" }`.

- **Cells** are tests on one input: a literal, a comparison (`<= 1`), an inclusive range
  (`[1..5]`), a JSON array meaning "any of", or `any`.
- **Hit policies:** `first` (first matching row), `unique` (exactly one row must match),
  `collect` (a list of results), and `sum`, `min`, `max`.
- **Fail-closed:** no match returns `default` if one is declared, otherwise fails with
  `DECISION_NO_MATCH`; two matches under `unique` fail with `DECISION_AMBIGUOUS`.
- `kerangka verify` reports gaps (input combinations no row covers) and overlapping rows.
- Tables can be imported from and exported to CSV, so business users can maintain them in a
  spreadsheet.

### 5.9 Time: schedules and timers

Real business logic depends on time: "mark invoices overdue every night", "escalate a leave
request that has waited three days".

```json
"schedules": {
  "markOverdue": { "cron": "0 1 * * *", "run": "Invoice.markOverdue", "for": "isOverdue" }
}
```

```json
"transitions": {
  "escalate": { "from": "submitted", "to": "escalated", "after": "P3D" }
}
```

- `for` selects the target records; the host runs the action for each, in pages.
- Durations are ISO 8601 (`PT4H`, `P3D`); `cron` is evaluated in `meta.timezone`.
- **The engine never waits.** Entering a state with a timed transition returns a `timer`
  effect (`{"kind": "timer", "at": "…", "action": "Leave.escalate", "target": "…"}`); the
  scheduler port stores it and runs the action when due. Leaving the state returns a
  `cancel-timer` effect.
- Timed transitions and schedules run as the system actor, and guards still apply.
- Business-day calendars (`P3BD`, public holidays) come later, from a package.

### 5.10 Connectors

Common I/O should need no host code. A connector is an extension whose implementation
Kerangka ships, configured in JSON:

```json
"extensions": {
  "fetchExchangeRate": {
    "connector": "http",
    "request": { "method": "GET", "url": "https://api.example.com/rates/${input.currency}",
                 "headers": { "Authorization": "Bearer ${secret:RATES_API_KEY}" } },
    "input": { "currency": "string!" },
    "output": { "rate": "decimal(18,8)!" },
    "map": { "rate": "response.body.rate" }
  }
}
```

- **Read connectors feed `uses`** (`"uses": { "rate": "fetchExchangeRate(currency)" }`) and
  are resolved before `run`, so the engine stays pure. **Write connectors run as `call`
  effects** after commit.
- Responses are validated against `output`; a failure is reported as `LOAD_FAILED` and the
  action does not run.
- Hosts are allowlisted per connector, private network ranges are blocked by default
  (protection against server-side request forgery), and secrets are only referenced, never
  written in documents.

| Connector | Purpose | Phase |
|---|---|---|
| `http` | Call external JSON APIs with typed input and output mapping | 2 |
| `sequence` | Readable numbering such as `INV-2026-000123`, backed by the store port | 2 |
| `email` | Templated email through SMTP or a provider | 2 |
| `oidc` | Login, roles, and tenant from an OpenID Connect provider | 3 |
| `webhook-out`, `webhook-in` | Signed outgoing and verified incoming webhooks | 4 |
| `files` | Upload, store, and serve files | 4 |
| `export` | CSV, XLSX, and PDF from queries, through UIDL's download support | 5 |
| `notify` | Push, SMS, and chat notifications | 5 (stretch) |

**The escape ladder.** When something cannot be expressed, the next step down is always
small and typed: built-in JSON → a `@kerangka/std` package → a decision table → a connector →
a portable WebAssembly (Wasm) component (compiled to `.wasm`, executing identically in every
engine via the Wasm Component Model; ADR-0030) → a code extension in the host language,
generated as a typed stub for stack-specific native integration. Code is the last rung, not
the first, and Wasm ensures custom logic remains portable across stacks.

### 5.11 Human tasks

Most business software routes work to people: approvals, reviews, queues. A workflow state
can declare a task:

```json
"workflow": {
  "field": "status",
  "tasks": {
    "approve": { "state": "submitted",
                 "assign": { "role": "manager", "where": "actor.department == department" },
                 "actions": ["approve", "reject"],
                 "due": "P2D", "onOverdue": "escalate" }
  }
}
```

- **Inbox, generated.** Every task becomes part of a generated `inbox` query and a "My
  tasks" view that lists, across contexts, the open tasks the current actor may act on.
- **SLA:** `due` creates a timer (§5.9); when it fires, the `onOverdue` transition runs.
- **Delegation** comes from a `@kerangka/std` trait; **notifications** from the `email` and
  `notify` connectors (§5.10).
- Assignment is advisory for the inbox; permissions still decide who may act (§9.6).

### 5.12 Effective-dated rules

Rates, fees, and policies change over time, and old records must keep the rules that were
valid when they happened.

```json
"decisions": {
  "serviceFeeRate": {
    "effectiveDate": "issuedOn",
    "versions": [
      { "validFrom": "2026-01-01", "rows": [{ "tier": "any", "result": "0.020" }] },
      { "validFrom": "2027-01-01", "rows": [{ "tier": "gold", "result": "0.015" },
                                            { "tier": "any",  "result": "0.020" }] }
    ]
  }
}
```

- The effective date is an explicit input (a field such as `issuedOn`; by default the date
  of `ctx.now`), so results stay deterministic and a record from 2026 is recomputed with the
  2026 rules.
- Rules and decision tables both accept `versions` with `validFrom` and optional `validTo`.
- `kerangka verify` reports overlapping periods and gaps between them.
- Publishing a new version without redeploying code, with review and rollback, is a
  Horizon 2 feature (§19); the semantics ship in 1.0 because they shape the IR.

### 5.13 Invariants

While guards check if an individual action is allowed to run, **invariants** are aggregate-level
integrity constraints that must hold across all states, after every action, and through data
migrations (ADR-0029).

```json
"invariants": [
  { "id": "paid_never_exceeds_total",
    "assert": "paidAmount <= totalAmount",
    "message": "Paid amount cannot exceed total invoice amount" },
  { "id": "closed_invoice_immutable",
    "when": "status == 'void' || status == 'paid'",
    "assert": "isUnchanged('lines')",
    "message": "Lines cannot be modified once an invoice is void or paid" }
]
```

- **Static analysis:** `kerangka verify` uses range analysis and workflow reachability to
  prove invariants cannot be breached by any valid sequence of actions.
- **Runtime assertion:** The engine verifies invariants before committing aggregate state; any
  breach aborts the transaction with `INVARIANT_VIOLATED` and triggers an automatic rollback.
- **AI self-healing:** When an AI assistant or human changes a model, violated invariants
  produce machine-readable diagnostics (§13) with precise constraint clues.

### 5.14 First-class multi-tenancy

Multi-tenancy is not an afterthought or a manual query filter; it is declared at the document
or context root (ADR-0031):

```json
"multitenancy": {
  "strategy": "discriminator",
  "field": "tenantId"
}
```

- **Strategies:**
  - `discriminator` (H1): Shared tables/collections; the engine automatically injects the
    tenant filter into every query and aggregate persistence operation, making tenant leaks
    impossible by construction.
  - `schema` (H2): PostgreSQL schema / search_path or MySQL database per tenant.
  - `database` (H2): Separate physical database connections per tenant for regulated workloads.
- **Tenant overlays (H2):** Tenants can overlay custom fields, decision tables, and workflows
  on top of the base model without forking the application source.

---

## 6. Architecture

```
               author (a person or an AI agent)
                        │   kerangka.json + contexts/**.kerangka.json, or one app.kerangka.json
                        ▼
┌──────────────── Kerangka compiler (TypeScript, one implementation) ─────────────────┐
│ load workspace, contexts, packages → parse with source positions → validate schema  │
│ → expand shorthand, traits, templates, defs → check exports and dependencies        │
│ → resolve names → type-check expressions → annotate numeric kinds → detect cycles   │
│ → lint and complexity budgets → emit canonical IR (whole app, or one per service)   │
└──────────────────────────────────┬──────────────────────────────────────────────────┘
                                   │   *.kir.json   (explicit, versioned, flat: no sugar, no modules)
        ┌──────────────────────────┼────────────────────────┬──────────────────────────┐
        ▼                          ▼                        ▼                          ▼
  Logic engines             Contract emitters         UIDL projector            Code generation
  TS · JVM · Python ·       JSON Schema · OpenAPI ·   views → UIDL documents    (later): typed
  Dart · Go · …             SQL DDL · typed models    → React / Flutter /       models, handlers,
        │                                               Android runtimes         "eject"
        ▼
  Framework adapters: Hono · Express · Quarkus · Spring Boot · FastAPI · net/http · …
  Store and cache:    PostgreSQL · SQLite · MySQL · MongoDB · Redis / Valkey · IndexedDB · …
  API projections:    REST · GraphQL · MCP · SSE · webhooks · gRPC        (§8)
```

### Principles

1. **One front end, many back ends.** All the hard work — parsing, shorthand, name
   resolution, type checking, and good error messages — happens once, in the compiler.
   Engines read only the canonical IR, which is small and explicit. Target: a new language
   engine in **3,000 lines or fewer**.
2. **Functional core, imperative shell.** `run(ir, action, record, input, actor, uses, ctx)
   → Result`. Engines contain no I/O, no clock, and no randomness; the clock and the ID
   generator arrive through `ctx`, so tests are deterministic.
3. **Interpret first, generate later.** Every stack gets an interpreter first: it handles
   documents loaded at run time, AI-generated documents, hot reload, and per-tenant
   customisation. Code generation comes later, and generated code must pass the same
   conformance suite.
4. **Standard contracts over bespoke emitters.** Emitting JSON Schema 2020-12 and
   OpenAPI 3.1 lets the existing generator ecosystem produce typed clients in dozens of
   languages without Kerangka writing each one.

### Why the compiler is written once, in TypeScript

- It reuses the UIDL TypeScript toolchain and expression evaluator.
- It ships as an npm package and as single-file native executables for people without
  Node.js (Node single-executable applications or `bun build --compile`; chosen in Phase 1).
- Engines never need the compiler at run time: they load IR. A stack that receives author
  JSON at run time (for example, a Java service accepting AI-generated documents) calls the
  compiler binary or the sidecar's `/compile` endpoint.
- If run-time compilation in non-JavaScript stacks becomes common, port the compiler to
  Rust and ship it as WebAssembly plus native binaries. That is a post-1.0 decision.

### 6.1 Reuse and modularity are compile-time

Workspaces, contexts, packages, traits, templates, and defs (§7) are resolved by the
compiler and flattened into the IR. Engines never resolve a module, merge a trait, or
expand a template, so modularity adds nothing to the per-language engines and cannot make
two engines disagree.

---

## 7. Modularity, reuse, and scale

A Kerangka application has to stay easy to work on as it grows from one file to many teams
and services. The approach: **the model is modular by construction, and the compiler
enforces the boundaries.** Good structure is the default path, not a discipline people
have to remember, and nothing in this section adds complexity to the engines (§6.1).

### 7.1 Building blocks

```
Workspace          kerangka.json: contexts, packages, lint preset
├── Context        one bounded context: its own language, exports, and dependencies
│   ├── Aggregate  a root entity plus its embedded entities; the unit of consistency
│   ├── Type       a value object without identity: Money, Address, Period
│   ├── Event      a published fact with a typed payload: InvoicePaid
│   ├── Policy     a reaction: when an event happens, run an action
│   ├── Query      a named, paginated read used by views and APIs
│   ├── View       screens owned by this context
│   └── Extension  a port to host code: email, payments, external APIs
├── Package        reusable types, traits, defs, templates, view templates, lint presets
└── Deployment     deploy.kerangka.json: which contexts run in which service (§7.6)
```

A single-file document (§5.1) is a workspace with one implicit context. When it grows,
it splits into files and contexts without changing its meaning.

### 7.2 Mapping to DDD and related architecture styles

| Concept | Kerangka |
|---|---|
| Bounded context | A `context`: a folder with `context.kerangka.json` |
| Ubiquitous language | The names in the context's documents plus its `glossary` |
| Context map | `dependsOn` and `exports`; `kerangka graph` draws it |
| Aggregate and aggregate root | An `aggregate` file: root entity plus embedded entities |
| Entity | The aggregate root or an embedded entity |
| Value object | A `type`: no identity, compared by value, with its own rules |
| Invariant | `rules` on the aggregate or the type |
| Domain event | Declared in `events`, raised with `emit` |
| Command / application service | An action |
| Domain service | A `def` when pure; an extension when it needs I/O |
| Specification | A predicate `def` (`isOverdue`) |
| Factory | A `create` action with defaults |
| Policy, reaction, process manager | A `policy`; long processes are workflows plus policies |
| Repository | The adapter's store, outside the model |
| Anti-corruption layer | An extension or a dedicated context that translates external events |
| Published language, open host service | Exported contracts emitted as OpenAPI, AsyncAPI, and JSON Schema |
| Shared kernel | A package used by several contexts |

It fits the neighbouring styles the same way:

- **Hexagonal / Clean architecture:** the engine is the domain core; actions are inbound
  ports (use cases); extensions and `uses` loads are outbound ports; framework adapters are
  the adapters.
- **CQRS:** actions write, queries read; projections (read models built from events) come
  later (§19).
- **Event-driven:** events, policies, and a transactional outbox in every adapter.
- **Modular monolith and microservices:** the same model, deployed either way (§7.6).
- **Micro-frontends:** each context owns its views, so UI splits along the same boundaries.

### 7.3 Recommended project structure

```
commerce/
├── kerangka.json                        workspace manifest
├── kerangka.lock                        resolved package versions
├── deploy.kerangka.json                 deployment topologies (§7.6)
├── contexts/
│   ├── catalog/
│   │   ├── context.kerangka.json        exports, dependsOn, glossary
│   │   ├── aggregates/Product.kerangka.json
│   │   └── views/products.kerangka.json
│   ├── ordering/
│   │   ├── context.kerangka.json
│   │   ├── aggregates/Order.kerangka.json
│   │   ├── policies.kerangka.json
│   │   └── views/
│   └── billing/
│       ├── context.kerangka.json
│       ├── types.kerangka.json
│       ├── defs.kerangka.json
│       ├── aggregates/Invoice.kerangka.json
│       ├── policies.kerangka.json
│       ├── queries.kerangka.json
│       ├── views/
│       └── examples/invoice-lifecycle.kerangka.json
└── services/                            host code, one folder per deployable
    ├── shop-api/                        for example TypeScript + Hono
    └── billing-api/                     for example Java + Quarkus
```

Conventions: one aggregate per file, each file named after what it defines, and every
context folder self-contained, so it can move to its own repository later.
`kerangka add context | aggregate | action | policy | query | view` generates this
structure, so nobody has to remember it.

**Workspace manifest** (`kerangka.json`):

```json
{
  "kerangka": "0.1",
  "app": "commerce",
  "contexts": ["catalog", "ordering", "billing"],
  "packages": { "@kerangka/std": "^0.2", "@acme/standards": "^1.4" },
  "lint": { "extends": ["kerangka:recommended", "@acme/standards/lint"] }
}
```

**Context** (`contexts/billing/context.kerangka.json`):

```json
{
  "context": "billing",
  "description": "Invoices and payments for placed orders",
  "dependsOn": { "ordering": { "entities": ["Order"], "events": ["OrderPlaced"] } },
  "exports": {
    "entities": { "Invoice": ["id", "number", "status", "total"] },
    "events": ["InvoicePaid"],
    "actions": ["Invoice.void"]
  },
  "glossary": { "Invoice": "A request for payment for exactly one order" }
}
```

**Aggregate** (`contexts/billing/aggregates/Invoice.kerangka.json`):

```json
{
  "aggregate": "Invoice",
  "traits": ["std:auditable", "std:tenantScoped"],
  "fields": {
    "number": "string! unique",
    "order": "ref(ordering:Order)!",
    "dueDate": "date!",
    "lines": "list(Line)",
    "status": "enum(draft, sent, paid, void) = draft",
    "total": { "type": "decimal(12,2)", "compute": "sum(lines, amount)" }
  },
  "entities": {
    "Line": { "fields": { "description": "string!", "amount": "decimal(12,2)! >= 0" } }
  },
  "events": {
    "InvoicePaid": { "invoice": "ref(Invoice)!", "order": "ref(ordering:Order)!",
                     "amount": "decimal(12,2)!" }
  }
}
```

**Policy** in another context (`contexts/ordering/policies.kerangka.json`):

```json
{
  "policies": {
    "markOrderPaid": {
      "on": "billing:InvoicePaid",
      "run": "Order.markPaid",
      "target": "event.order",
      "input": { "paidAmount": "event.amount" }
    }
  }
}
```

### 7.4 Boundaries the compiler enforces

| Rule | Why | Compile error |
|---|---|---|
| Outside a context, only its `exports` are visible | Internals can change without breaking anyone | `NOT_EXPORTED` |
| A cross-context reference is an id only: `ref(ordering:Order)` never joins or navigates; exported fields are read through a `uses` load | No hidden coupling; every context can own its own database | `CROSS_CONTEXT_NAVIGATION` |
| Structural dependencies — references, shared types, `uses` loads, calls to exported actions — form a directed acyclic graph. Event subscriptions may flow both ways, because they are asynchronous and depend only on published event schemas | No dependency knots; each context builds and tests alone | `DEPENDENCY_CYCLE` |
| An action changes exactly one existing aggregate instance; it may also create new aggregates in its own context. Everything else changes through events and policies | One transaction is one aggregate: no distributed transactions, no lock chains | `MULTI_AGGREGATE_WRITE` |
| Every emitted event is declared with a typed payload | Events are contracts between teams | `UNDECLARED_EVENT` |
| Every extension a context calls is declared with typed input and output | Host code stays behind explicit ports | `UNDECLARED_EXTENSION` |

### 7.5 Reuse without copy-paste

Everything reusable is resolved by the compiler (§6.1).

| Mechanism | What it reuses | Example |
|---|---|---|
| **Types** (value objects) | Groups of fields with their own rules | `std:Money`, `std:Address`, `std:Period` (`start <= end`) |
| **Traits** | Fields, rules, defaults, read filters, and permissions mixed into aggregates | `std:auditable`, `std:softDelete`, `std:tenantScoped` |
| **Defs** | Named pure expressions: predicates and calculations | `"isOverdue": "status == 'sent' && dueDate < today()"`, used in rules, guards, queries, and views |
| **Templates** | Parameterised fragments: workflows, actions, views | `std:approval` workflow with `submitter` and `approver` roles; `std:masterDetail` view |
| **Packages** | Versioned bundles of all of the above, plus lint presets | `@kerangka/std`; an organisation's `@acme/standards` |

A trait:

```json
"tenantScoped": {
  "fields": { "tenantId": { "type": "string!", "system": true, "immutable": true } },
  "defaults": { "tenantId": "actor.tenantId" },
  "readFilter": "tenantId == actor.tenantId"
}
```

Limits that stop reuse from becoming a hidden programming language:

- **Defs** may call other defs but never recursively; the compiler inlines them.
- **Templates** substitute values only (`${param}` becomes a JSON value). They contain no
  conditionals and no loops.
- **Traits** never override silently: two definitions of the same field are a compile
  error; an aggregate drops a trait member only with an explicit `exclude`.
- `kerangka expand` prints the fully expanded result, so nothing is magic.

**Reusable code, on the host side.**

- **Business decisions live in documents; host code only does I/O.** A handler receives
  validated, typed input and returns typed output. It never decides, for example, whether
  an invoice may be sent.
- Extension contracts are declared in documents; implementations are ordinary packages per
  language (an email sender for Node.js, another for Quarkus). At startup the adapter checks
  that every declared extension has a handler with a matching contract.
- Other services call a context through a client generated from its exported contract,
  never through hand-written HTTP calls.
- Generated code lives in a `generated/` folder, is never edited, and is checked for
  freshness in CI. Hand-written code sits beside it (the "generation gap" pattern), so
  regeneration is always safe.

**Reusable standards, at organisation level.** A package can carry an organisation's
standards: required traits (for example, every aggregate is `auditable`), naming rules,
complexity budgets, REST path style, error envelope, and view templates. A project adopts
them with one line in `kerangka.json`, and upgrading the package upgrades the standard in
every project.

### 7.6 From modular monolith to microservices

The model never mentions deployment. `deploy.kerangka.json` decides which contexts run
together:

```json
{
  "topologies": {
    "dev": {
      "services": { "app": { "contexts": ["catalog", "ordering", "billing"] } },
      "events": "in-process"
    },
    "production": {
      "services": {
        "shop-api":    { "contexts": ["catalog", "ordering"], "stack": "ts-hono" },
        "billing-api": { "contexts": ["billing"], "stack": "jvm-quarkus" }
      },
      "events": "broker"
    }
  }
}
```

- `kerangka build --topology production --service billing-api` emits an IR containing only
  the `billing` context plus the exported contracts it depends on.
- Contexts in the same service exchange events in process; contexts in different services
  use the broker and generated clients. The model is identical either way.
- **Recommendation: start as a modular monolith.** Split a context out only for a concrete
  reason: an independent team, a different scaling profile, or a different stack. Because
  the compiler already forbids cross-context joins and multi-aggregate writes, splitting is
  a change to the deployment file, not a rewrite.
- **Contracts between services:** OpenAPI 3.1 for exported actions and queries,
  AsyncAPI 3.0 for events, and JSON Schema for payloads. Events travel in the CloudEvents
  envelope, a CNCF standard, so brokers and serverless platforms understand them as-is.
- **Zero-downtime evolution (Expand/Contract):** In rolling deployments across microservices
  or multi-instance monoliths, old and new nodes run simultaneously. The compiler and
  `kerangka diff` enforce the expand/contract pattern (ADR-0032): additions are backward-compatible;
  removals and type changes require a two-phase transition where old and new fields/events coexist
  (`InvoicePaid.v1` and `InvoicePaid.v2`); breaking changes fail CI unless explicitly approved
  as a major version upgrade.
- **Reliability in the adapters, not in the model:** a transactional outbox for `emit`
  effects, idempotent policy execution keyed by event id and policy name, retries with
  backoff, and dead-letter handling from the broker. Cross-service processes (sagas) are
  workflows plus policies with compensating actions.
- **Brokers are adapter packages:** in-process and a PostgreSQL-backed outbox first (no
  broker needed); Kafka, NATS, and RabbitMQ later.
- **Frontend:** each context owns its views, and the shell composes navigation from the
  contexts deployed together.

### 7.7 Complexity budgets

`kerangka lint` with the `kerangka:recommended` preset keeps files and logic small. Every
value is configurable, and an organisation preset can tighten them.

| Budget | Default | When exceeded, the hint suggests |
|---|---|---|
| Lines per file | 300 | Split the aggregate, or move views and policies to their own files |
| Fields per aggregate, traits included | 40 | Extract a value object or a new aggregate |
| Statements per action | 10 | Move logic into defs, or split the action |
| Nodes per expression | 30 | Name the parts as defs or computed fields |
| Transitions per workflow | 15 | Split the lifecycle |
| Aggregates per context | 12 | The context is probably two contexts |
| Structural dependencies per context | 4 | Revisit the context map |

Naming rules in the same preset: contexts in kebab-case; aggregates, types, and events in
PascalCase, with events in the past tense (`InvoicePaid`); fields, actions, and defs in
camelCase. Unused exports, fields, and defs produce warnings. With `--topology`, lint also
warns about every `uses` load that crosses a service boundary, because each one is a
synchronous network call.

`kerangka stats` reports these numbers per context, and `kerangka graph` draws the context
map as Mermaid for documentation and reviews. Host code cannot be linted by Kerangka; the
generated handler skeleton and the review checklist target handlers under 100 lines.

### 7.8 Scaling at run time

- **Stateless engines, immutable IR:** load once per process, share across requests and
  threads, scale horizontally.
- **One aggregate per transaction** with optimistic `version` checks: no cross-aggregate
  locks and no distributed transactions.
- **Reads through `queries`:** pagination is mandatory, `readFilter` is pushed into the
  database, and only selected fields are fetched. Heavy reads across contexts use
  projections, never joins across services.
- **Per-service IR** holds only that service's contexts: less memory, faster startup.
- **Incremental compilation** per context keeps feedback fast in large workspaces.
- **Multi-tenancy** declared first-class (§5.14, ADR-0031), enforced by the engine and
  automatically pushed down into store queries and writes.

### 7.9 Easy to work on

- **Scaffolding** (`kerangka add …`) creates files in the standard structure, with an
  example test in each.
- **Ownership:** one context, one owning team (`CODEOWNERS` per `contexts/<name>/`).
- **Isolation:** `kerangka test contexts/billing` builds and tests one context alone, with
  its dependencies stood in by their exported contracts.
- **One-command local run:** `kerangka dev` runs every context in one process with an
  in-process event bus, whatever the production topology.
- **Small reviews:** one aggregate per file and the complexity budgets keep diffs focused.
- **AI agents work per context too:** the MCP server scopes validation, examples, and
  previews to one context.

---

## 8. State, storage, and APIs

### 8.1 Design: one core, ports, adapters, projections

Everything around the engine — databases, caches such as Redis, message brokers, APIs,
client storage — follows one design, so each new technology is an adapter and never a
change to the engine or the model.

```
┌─ Model (JSON) ────────────────────────────────────────────────────────────┐
│ contexts · aggregates · rules · decisions · workflows · events · views    │
└─────────────────────────────────────┬─────────────────────────────────────┘
                              compiler ▼ flat IR
┌─ Core: pure engine, one per language ─────────────────────────────────────┐
│ validate · compute · decide · run · react · queryPlan · available         │
└─────────────────────────────────────┬─────────────────────────────────────┘
          ports: a small, fixed set, each with its own test kit (§14)
  Store · Cache · Bus · Scheduler · Realtime · Files · Connectors · Secrets ·
  Telemetry · Client store
                                      ▼
┌─ Adapters: packages, chosen per service by configuration ─────────────────┐
│ PostgreSQL · SQLite · MySQL · MongoDB · Redis / Valkey · NATS · Kafka ·   │
│ S3 · IndexedDB · OpenTelemetry · …                                        │
└───────────────────────────────────────────────────────────────────────────┘
  Projections, generated from the same IR: REST · GraphQL · MCP · SSE · gRPC ·
  UIDL screens · SQL DDL and migrations · OpenAPI · AsyncAPI · GraphQL SDL
```

| Port | Responsibility | Default, with no extra infrastructure | Other adapters |
|---|---|---|---|
| Store | Load and save aggregates with version checks; execute query plans; outbox; timers; sequences; append-only audit trail | SQLite or PostgreSQL | MySQL, SQL Server, MongoDB, … (§8.4) |
| Cache | Query-result and aggregate caching, rate limits, idempotency keys | In-process memory, or the database | Redis, Valkey, Memcached (caching only) (§8.5) |
| Bus | Deliver events between contexts and services | In process; database outbox polling | Redis Streams, NATS, Kafka, RabbitMQ |
| Scheduler | Fire timers and cron schedules (§5.9) | A database timer table polled by the service | Host job systems, cloud schedulers |
| Realtime | Push committed patches and events to clients | In process (one instance) | Redis pub/sub or the bus, for fan-out across instances |
| Files | Store uploaded files | Local disk | S3-compatible storage |
| Connectors | Outbound HTTP, email, notifications (§5.10) | Built-in `http` | Provider packages |
| Secrets | Resolve `${secret:NAME}` | Environment variables | Vault, cloud secret managers |
| Telemetry | Traces, metrics, logs | OpenTelemetry SDK | Any OpenTelemetry backend |
| Client store | Cache, drafts, and offline outbox on devices | Memory | IndexedDB, SQLite (§8.3) |

Design rules:

1. **The engine stays pure.** Ports are the only way out, and the set of ports is fixed by
   the spec. Adding a technology means adding an adapter.
2. **The database is the only source of truth.** Caches, buses, and client stores can be
   rebuilt from it. Losing Redis loses no data.
3. **One database is enough to start.** Every port has a default that needs nothing but the
   database: outbox, timers, idempotency keys, and sequences all work on PostgreSQL or
   SQLite alone. Redis and a broker are added by configuration when measurements call for
   them (§8.7).
4. **Adapters are configuration, not code.** Each service picks its adapters in
   `deploy.kerangka.json`; connection strings and credentials come from the environment.
5. **Every port has a test kit**, and every adapter — ours or the community's — must pass it,
   just as engines must pass conformance.
6. **Projections are generated, never hand-written.** API surfaces, screens, DDL, and
   contracts all come from the IR, so they cannot drift from the rules.

### 8.2 State management: who owns which state

| State | Examples | Owner | Where it lives |
|---|---|---|---|
| UI state | Open dialogs, active tab, filters, sort order | UIDL `state.*` | Memory; the URL or `localStorage` for preferences |
| Form drafts | An invoice being edited, not yet saved | Kerangka client | Memory; IndexedDB or SQLite when draft persistence is on |
| Server-state cache | Records and query results already fetched | Kerangka client | Memory, keyed by query and id; optionally persisted |
| Offline data and pending actions | Records available offline; actions waiting to sync | Kerangka client | IndexedDB (web), SQLite (mobile, desktop) |
| Session | Actor, roles, tenant, locale | Host authentication | Host session or token; passed to the engine as `actor` |
| Domain state (source of truth) | Aggregates and their workflow status | Store port | The database |
| Shared server cache | Hot query results, rate-limit counters, idempotency keys | Cache port | Memory, or Redis / Valkey across instances |
| Time-based state | Pending timers and schedules | Scheduler port | The database |

- UIDL keeps UI state; Kerangka never duplicates it.
- The client applies the `patch` from every `run` result to its cache, so screens update
  without refetching.
- **Optimistic updates:** the client runs the action locally with the same engine, shows the
  result immediately, and sends the action to the server; if the server rejects it, the
  cache rolls back and the errors appear on the form.
- **Real-time:** the server pushes committed patches and events over SSE or WebSocket, and
  clients update their caches.

### 8.3 Local storage and offline

- **`localStorage` is for small preferences only** (theme, last tab), never business data:
  it is synchronous, limited to a few megabytes, stores strings only, has no transactions,
  and any script running on the page can read it.
- **IndexedDB on the web; SQLite on mobile and desktop** (Flutter `sqflite` or `drift`,
  Android Room). SQLite on the web through WebAssembly and OPFS is a later option.
- **Offline is declared per entity:**

  ```json
  "client": {
    "drafts": "persist",
    "realtime": ["Invoice"],
    "offline": {
      "Invoice": { "scope": "status != 'void'", "limit": 5000,
                   "actions": ["create", "update", "send"], "conflict": "reject-and-review" }
    }
  }
  ```

- **Offline writes replay actions, not diffs.** The client stores
  `{action, target, input, expectedVersion}` in a local outbox. On reconnect the server runs
  the same action again, with full validation and permission checks. Because engines are
  deterministic, the server result matches the local one unless the data changed in the
  meantime; then the `conflict` policy applies: `reject-and-review` (the default: the user
  sees what changed and retries), `server-wins`, or `retry` (re-run on the latest version,
  for actions that are safe to repeat).
- **Sensitive data stays online.** Fields marked `"sensitive": true` are never cached or
  stored offline; offline stores are cleared on logout and encrypted where the platform
  supports it.

### 8.4 Databases

The engine never talks to a database; every database is a store adapter.

| Database | Role | Phase |
|---|---|---|
| In-memory | Tests and `kerangka dev` | 1–2 |
| PostgreSQL | Reference server store | 2 |
| SQLite | Local development, edge and embedded deployments, tests | 2 |
| MySQL / MariaDB | Server store | 4 |
| SQL Server | Server store | 5 (stretch) |
| MongoDB | Document store: one aggregate is one document | 5 (stretch) |
| IndexedDB, client SQLite | Client cache and offline (§8.3) | 3, 5 |
| Oracle, DynamoDB, Firestore, Cassandra, others | Community adapters, certified by the store test kit | After 1.0 |

**Default relational mapping:** one table per aggregate root; scalar fields become columns
(indexable and queryable); embedded lists become a JSON column loaded and saved with the
root; a `version` column carries optimistic concurrency. One aggregate is one row and one
short transaction. `"storage": "tables"` opts an embedded list into its own child table when
it needs indexes.

**Indexes** come from `unique`, references, and the `where` and `orderBy` of declared
queries; explicit `indexes` are allowed, and lint warns when a query filters on an
unindexed field.

**Existing databases.** `kerangka db import` reads an existing schema and drafts entities;
`storage` mappings let a model sit on legacy tables without renaming them:

```json
"Invoice": { "storage": { "table": "tbl_invoice", "columns": { "number": "inv_no" } } }
```

**Migrations from model changes.** `kerangka db diff` compares the model with the previous
release (or the live schema) and writes migration files: plain SQL first, then Flyway and
Alembic formats (Phase 4). `renamedFrom` turns a drop-and-add into a rename; data backfills
are written as JSON statements; destructive steps (dropping a column, narrowing a type) fail
CI unless explicitly approved.
- **Zero-downtime migrations (Expand/Contract):** Migrations follow the two-phase expand/contract
  pattern (ADR-0032): phase A (Expand) adds nullable columns and views without locking; phase B
  (Contract) removes deprecated columns after all services have updated.
- **Multi-tenancy at the store port:** For `discriminator`, every query automatically receives
  `AND tenant_id = :tenantId`. For `schema` and `database` strategies (H2), connection routing
  and tenant search paths are handled transparently by the store adapter (ADR-0031).

```json
"customerName": { "type": "string!", "renamedFrom": "clientName" }
```

### 8.5 Redis and other caches

Redis and similar systems are **accelerators and coordinators, never the source of truth.**

| Use | How Kerangka uses the cache port | Without Redis |
|---|---|---|
| Query-result cache | Queries may declare `"cache": { "ttl": "PT1M" }`; entries are invalidated when a committed patch touches them | In-process memory per instance |
| Aggregate cache | Read-through cache for `load`; invalidated on commit | No cache; read from the database |
| Rate limits | Actions may declare `"rateLimit": { "per": "actor", "limit": 10, "window": "PT1M" }` | In-process counters (per instance) or the database |
| Idempotency | Keys for policies and for the API `Idempotency-Key` header | A database table |
| Real-time fan-out | Redis pub/sub delivers patches to every instance holding SSE or WebSocket clients | One instance only |
| Event transport | Redis Streams as a lightweight bus adapter | Database outbox polling |

- **A stale cache can never cause a wrong write.** Every write checks the aggregate's
  `version` in the database, so a stale read ends at worst in a `409` and a retry.
- **Cache keys include the query, its parameters, and a hash of the applied `readFilter`**,
  so a cached result is never served across tenants or roles.
- **One adapter for the Redis protocol family.** It is tested against Redis and Valkey (the
  Linux Foundation fork created after Redis changed its licence in 2024); other servers that
  speak the same protocol and managed cloud offerings work through the same adapter.
  Memcached is supported for caching only.
- Distributed locks are deliberately absent: optimistic concurrency and one aggregate per
  transaction make them unnecessary.

### 8.6 APIs

| Protocol | What is generated | Phase |
|---|---|---|
| REST | Resource routes, action routes (`POST /invoices/{id}/send`), named queries with filtering, sorting, and cursor pagination; OpenAPI 3.1; errors as RFC 9457 Problem Details; `Idempotency-Key` support | 2 |
| JSON-RPC and HTTP sidecar | The engine itself, for any language (§11) | 2 |
| AsyncAPI | Event contracts between services (§7.6) | 2 |
| Server-sent events / WebSocket | Committed patches and events for real-time clients | 3 |
| MCP, for AI agents | Every exported action and query as a tool, with the caller's permissions enforced | 3 |
| GraphQL | Schema from exported entities; queries from named queries; mutations from actions; subscriptions from events; batching against N+1; depth and cost limits | 4 |
| Webhooks | Outgoing events signed with HMAC; incoming webhooks verified and mapped to actions (§5.10) | 4 |
| gRPC | `.proto` files and services from contracts | 5 (stretch) |
| GraphQL federation | One subgraph per service | After 1.0 |

Rules that keep every protocol equivalent:

- Every protocol calls the same `run`, `queryPlan`, and `react`, so permissions, rules, and
  errors are identical. A conformance class runs the same scenario through REST and GraphQL
  and compares the results.
- Which protocols a service exposes is a deployment choice (§8.7); the model does not
  change.
- Naming and conventions (path style, casing, pagination style, error envelope) come from
  organisation standards packages (§7.5).
- An action or query marked `"internal": true` is available between services but never on a
  public API.

### 8.7 Infrastructure profiles and configuration

| Profile | Infrastructure | Fits |
|---|---|---|
| **Starter** | One SQLite or PostgreSQL database, nothing else | Prototypes, small applications, edge deployments, learning |
| **Standard** | PostgreSQL plus Redis or Valkey | Most production applications: several instances, shared cache, rate limits, real-time fan-out |
| **Distributed** | A database per service, Redis or Valkey, and a broker (NATS or Kafka) | Microservices (§7.6) |

Moving between profiles changes `deploy.kerangka.json`, never the model:

```json
"production": {
  "services": {
    "shop-api": {
      "contexts": ["catalog", "ordering"], "stack": "ts-hono",
      "api": ["rest", "graphql", "mcp"],
      "infra": { "store": "postgres", "cache": "redis", "bus": "outbox+nats", "files": "s3" }
    }
  }
}
```

Connection strings and credentials never appear in the file; adapters read them from the
environment (for example `KERANGKA_STORE_URL`).

### 8.8 Observability

Adapters emit OpenTelemetry traces and metrics named after the model: a span per action,
policy, query, decision, and connector call, with attributes for context, aggregate,
outcome, and error code, plus a counter per rule failure. Operations can see
"`Invoice.send` failed 12% of the time with `GUARD_FAILED`" with no manual instrumentation.
A correlation id follows every request through events and policies, across services.

---

## 9. Semantics that must be identical everywhere

This is the core risk of "every stack". Each item becomes a file in `spec/semantics/`,
backed by conformance cases.

### 9.1 Types and their JSON encoding

| Type | JSON encoding | Notes |
|---|---|---|
| `string` | string | Length counts Unicode code points |
| `text` | string | Multi-line; same rules as `string` |
| `int` | number | Restricted to ±(2^53 − 1) so JavaScript represents it exactly; larger ids use `string` |
| `decimal(p,s)` | **string**, e.g. `"12.50"` | Exact; p ≤ 28 so .NET `decimal` can hold it |
| `float` | number | IEEE 754 binary64; linted when a field name looks like money |
| `bool` | boolean | |
| `date` | `"2026-09-27"` | ISO 8601 calendar date |
| `datetime` | `"2026-09-27T03:00:00.000Z"` | UTC instant, millisecond precision, always `Z` |
| `time` | `"10:30:00"` | Local time of day |
| `uuid` | string | Generated by the host's id generator (UUIDv7 recommended) |
| `email`, `url` | string | A specified, simple format check, not a full RFC parser |
| `enum(...)` | string | |
| `ref(E)` | string | The referenced record's key |
| `list(T)` | array | |
| embedded entity | object | |
| `json` | any | Escape hatch; not validated beyond being JSON |

### 9.2 Numbers

- **Decimals are strings on the wire** so no JSON parser turns them into doubles.
- **Engines use a real decimal type**: `BigDecimal` on the JVM, `decimal.Decimal` in
  Python, `package:decimal` in Dart, and a vetted decimal library in TypeScript and Go.
- **Rounding** is HALF_EVEN by default; `round(x, scale, "half-up")` makes other modes
  explicit.
- **Division** computes to an intermediate scale of 20 and rounds to the target field's
  scale on assignment.
- The compiler annotates every numeric operation in the IR with its kind
  (`"num": "int" | "decimal" | "float"`), so no engine has to infer types at run time.
- Conformance includes the classic traps: `3 × 0.10 = 0.30`, not `0.30000000000000004`.

### 9.3 Strings, dates, regular expressions, JSON

- Strings compare by Unicode code point, independent of locale. Case functions use the
  Unicode default mapping without a locale.
- `today()` and `now()` read `ctx.now`; `today()` is evaluated in `meta.timezone`
  (default UTC).
- Patterns use an **RE2-compatible subset** (no backreferences, no lookaround): linear
  time, immune to ReDoS, and portable. Engines use RE2 bindings or a checked translation.
- Snapshots, hashes, and conformance comparisons use canonical JSON (RFC 8785).

### 9.4 Expressions

- The canonical AST is the **UIDL expression grammar 1.x**: `literal`, `$bind`, `$expr`,
  `agg`, and the operators `eq neq gt gte lt lte and or not add subtract multiply divide
  contains startsWith coalesce if`.
- **Extension set K1**, proposed upstream to UIDL: `mod`, `neg`, `concat`, `lower`,
  `upper`, `trim`, `len`, `round`, `min`, `max`, `in`, `matches`, `today`, `now`,
  `addDays`, `diffDays`, and per-row aggregates `sum / count / avg / min / max / any / all`
  with an `each` expression.
- Evaluation is total and bounded: depth 64 (as in UIDL), a node-count cap per document, and
  a list-size cap per evaluation, both host-configurable.

### 9.5 Fail-closed checks

UIDL expressions return `null` rather than throwing (for example, on division by zero).
That is right for display, but dangerous for business logic. Therefore:

> A rule, guard, or permission condition passes **only when it evaluates to exactly
> `true`.** `false`, `null`, a missing value, or an evaluation error fails it, with a
> specific code (`RULE_FAILED`, `GUARD_FAILED`, `FORBIDDEN`, or `RULE_INDETERMINATE`).

### 9.6 Order of execution for `run`

1. Resolve the action; unknown → `UNKNOWN_ACTION`.
2. Check permissions (role, then row condition) → `FORBIDDEN`.
3. Validate `input` against its declared fields → `INPUT_INVALID`.
4. Evaluate the guard (`when`) → `GUARD_FAILED`; check the transition's `from` →
   `INVALID_TRANSITION`.
5. Execute statements, in order, on a working copy.
6. Recompute computed fields in dependency order (the compiler rejects cycles).
7. Check field constraints and rules; collect **all** failures.
8. Build `record`, `patch`, and `effects`.

Errors are sorted by JSON pointer, then by code, so every engine reports them in the same
order.

### 9.7 Error codes

`SCHEMA_INVALID`, `UNSUPPORTED_VERSION`, `UNKNOWN_ACTION`, `UNKNOWN_EXTENSION`,
`FORBIDDEN`, `INPUT_INVALID`, `GUARD_FAILED`, `INVALID_TRANSITION`, `REQUIRED`,
`TYPE_MISMATCH`, `OUT_OF_RANGE`, `PATTERN_MISMATCH`, `NOT_UNIQUE` (reported by adapters),
`RULE_FAILED`, `RULE_INDETERMINATE`, `DECISION_NO_MATCH`, `DECISION_AMBIGUOUS`,
`RATE_LIMITED` and `LOAD_FAILED` (reported by adapters), `LIMIT_EXCEEDED`. Where a code
overlaps with UIDL's error taxonomy, the UIDL name wins.

### 9.8 Decision tables and time

- Decision rows are evaluated top to bottom; the hit policy decides the result (§5.8). Cell
  tests use the same numeric and string semantics as expressions.
- Durations follow ISO 8601. Adding months clamps to the last day of the month
  (31 January + `P1M` = 28 or 29 February), a classic source of cross-language drift, so it
  has its own conformance cases.
- `cron` uses the standard five fields in `meta.timezone`. A schedule that falls in a
  daylight-saving gap runs at the next valid instant; a repeated local time runs once.

---

## 10. Runtime API

The same operations in every language, named idiomatically.

| Operation | Purpose |
|---|---|
| `load(ir) → App` | Validate IR against the IR schema, build indexes, reject unsupported versions |
| `app.validate(entity, record) → Error[]` | Field constraints and rules |
| `app.compute(entity, record) → record` | Fill defaults and computed fields |
| `app.can(actor, operation, entity, record?) → bool` | Permission check |
| `app.available(entity, record, actor) → ActionInfo[]` | Actions and transitions the actor may run now; drives buttons in the UI |
| `app.plan(action, record) → Load[]` | What the host must load before `run` |
| `app.run(action, {record, input, actor, uses, ctx, trace?}) → Result` | Execute; with `trace`, also return the evaluation trace (§13) |
| `app.decide(table, inputs) → value` | Evaluate a decision table on its own |
| `app.schedules() → Schedule[]` | Cron schedules for the scheduler port |
| `app.readFilter(entity, actor) → Predicate` | Row-level read predicate as an AST, for adapters to push into queries |
| `app.queryPlan(query, params, actor) → QueryPlan` | A named query as predicate AST, selected fields, order, and page size, with `readFilter` applied, for the adapter to execute |
| `app.react(event) → Invocation[]` | The policies an event triggers: action, target, input, and idempotency key for each |
| `app.describe() → Metadata` | Contexts, entities, actions, events, queries, and routes, for adapters and tooling |

| Language | Call |
|---|---|
| TypeScript | `const r = app.run("Invoice.send", { record, actor, ctx });` |
| Java | `Result r = app.run("Invoice.send", RunRequest.of(record).actor(actor));` |
| Kotlin | `val r = app.run("Invoice.send") { record = invoice; actor = user }` |
| Python | `r = app.run("Invoice.send", record=invoice, actor=user)` |
| Dart | `final r = app.run('Invoice.send', record: invoice, actor: user);` |
| Go | `r, err := app.Run("Invoice.send", kerangka.Input{Record: invoice, Actor: user})` |

Records cross the boundary as the language's plain JSON values (maps, dicts, objects).
Typed wrappers generated from the IR come in Phase 4.

### What a framework adapter does

```
POST /invoices/{id}/send
 → authenticate                            → actor
 → store.load("Invoice", id)               → record
 → app.plan("Invoice.send", record)        → loads → store.resolve(loads) → uses
 → app.run("Invoice.send", {...})          → Result
 → if ok, in one transaction:
      apply persist effects (check expectedVersion)
      write emit effects to an outbox
 → after commit: dispatch call effects to registered handlers
 → 200 {record} | 403 FORBIDDEN | 409 version conflict | 422 {errors}

event billing:InvoicePaid arrives (in process, or from the broker)
 → app.react(event)                        → [{ action: "Order.markPaid", target, input, idempotencyKey }]
 → skip any invocation whose idempotencyKey was already processed
 → load the target, then plan → run → apply effects, exactly as above
```

---

## 11. Tech stack coverage

"Every stack" is delivered in four layers, so each stack gets something on day one and
native quality over time.

| Layer | What a stack gets | From |
|---|---|---|
| **L0 — Contracts** | JSON Schema, OpenAPI 3.1, and SQL DDL from the CLI; typed clients through existing generators | v0.2 |
| **L1 — Sidecar** | `kerangka serve`: the engine over HTTP/JSON and stdio JSON-RPC, callable from any language | v0.2 |
| **L2 — Native engine** | The engine in-process, certified by the conformance suite | per tier |
| **L3 — Framework adapter** | Automatic REST endpoints, persistence effects, auth mapping | per framework |

### Tiers

| Tier | Language | Engine | First adapters | Target |
|---|---|---|---|---|
| 1 (reference) | TypeScript / JavaScript — Node.js, Deno, Bun, browsers | Native | Hono (runs on Node.js, Deno, Bun, and edge workers), Express | v0.2 |
| 1 | JVM — Java and Kotlin | Native | Quarkus extension, Spring Boot starter | v0.4 |
| 1 | Python | Native | FastAPI (Django later) | v0.4 |
| 1 | Dart | Native | Flutter client (offline validation), `shelf` server | v0.5 |
| 1 | Go | Native | `net/http` (works with chi and echo) | v0.5 |
| 2 (certified, community) | C# / .NET, Swift, Rust, PHP, Ruby | Contributed; certified at 100% conformance | ASP.NET Core, Vapor, Axum, Laravel, Rails | after 1.0 |
| 3 (everything else) | Any language that speaks HTTP and JSON | Sidecar (L1) and contracts (L0) | — | v0.2 |

**Why these five are Tier 1:** TypeScript covers web front and back ends; the JVM covers
enterprise backends and Android; Python covers AI and data backends; Dart covers Flutter on
mobile and desktop; Go covers cloud services. UIDL already renders in TypeScript, Kotlin,
and Dart, so client-side validation lands exactly where UIDL renders.

**Certification.** An engine may call itself "Kerangka *x.y* compatible" only when it
passes 100% of the active conformance cases for spec *x.y* in CI, with results published
to the compatibility matrix.

---

## 12. Frontend strategy

1. **Views become UIDL documents** (Phase 3): list, form, detail, and dashboard; wizard
   later. The projector uses UIDL `definitions`, `$query` data sources, `mutate` and
   `command` actions, `fieldErrorsPath`, and `session.permissions.*` visibility gating.
2. **Zero configuration.** If `views` is omitted, the projector scaffolds a list and a form
   for each non-embedded entity, plus a navigation shell.
3. **Rendering targets are UIDL's targets:** today React (web), Flutter (mobile, desktop,
   web), and Android. New targets — SwiftUI, Web Components (covering Vue, Svelte, and
   Angular at once), React Native — are added in UIDL, and Kerangka gets them for free.
4. **The same logic runs on the client.** Forms run the engine locally for instant
   validation, computed fields, and enabled or disabled action buttons (`available`). The
   server re-runs everything; the client is never trusted. Caching, optimistic updates,
   drafts, real-time updates, and offline follow §8.2–8.3.
5. **Bridge packages:** `@kerangka/uidl` (TypeScript) and `kerangka_flutter` (Dart)
   implement UIDL's mutation and command handler on top of a Kerangka API client or a local
   engine. As Kerangka's needs evolve, `UIDL-Runtime` is directly adjusted to provide first-class
   hooks, components, and data adapters tailored for Kerangka applications.
6. **Headless option:** `@kerangka/client` exposes form state (values, errors, computed
   values, available actions) for teams that render with their own components and no UIDL.
7. **Customisation without forking:** a view may name an `override` — a hand-written UIDL
   fragment merged by node id — so generated screens stay editable.
8. **Views follow context boundaries.** Each context owns its views; the application shell
   composes navigation from the contexts deployed together. Reusable view templates
   (`std:masterDetail`, an organisation's own layouts) come from packages, and UIDL
   `definitions` carry reusable UI components.

---

## 13. Tooling, learning, and AI authoring

### CLI

| Command | Purpose |
|---|---|
| `kerangka init [template]` | Scaffold a workspace (or a single-file document) and a host project |
| `kerangka add context \| aggregate \| action \| policy \| query \| view` | Generate files in the standard structure (§7.3), each with an example test |
| `kerangka check [path]` | Validate; errors carry a code, JSON pointer, line and column, and a hint |
| `kerangka lint [path]` | Boundaries, naming rules, and complexity budgets (§7.7) |
| `kerangka expand <doc>` | Print the document with every shorthand, trait, template, and def expanded |
| `kerangka build [--topology t --service s]` | Compile to canonical IR: the whole application, or one service |
| `kerangka emit <target>` | `jsonschema`, `openapi`, `asyncapi`, `sql:postgres`, `uidl`, `types:ts`, `types:java`, `types:python`, `client:<lang>`, `compose`, `k8s`, … |
| `kerangka diff <old> <new>` | Classify changes to exported contracts as compatible or breaking; a CI gate |
| `kerangka graph` | Draw the context map as Mermaid |
| `kerangka stats` | Complexity numbers per context |
| `kerangka verify [path]` | Static analysis of workflows, permissions, rules, decision tables, and events |
| `kerangka explain <doc> <action>` | The evaluation trace in plain sentences |
| `kerangka learn` | Interactive exercises, level 1 to 8 |
| `kerangka docs` | Generated documentation site with diagrams |
| `kerangka db import \| diff` | Draft a model from an existing database; write migrations from model changes |
| `kerangka decisions import \| export` | Round-trip a decision table through CSV |
| `kerangka import <file>` | Draft a model from a spreadsheet (Excel, CSV) in 1.0; from OpenAPI, JSON Schema, Prisma, JHipster JDL, BPMN, or DMN in Horizon 2 |
| `kerangka test <doc>` | Run the document's `examples` |
| `kerangka run <doc> <action> --record r.json --input i.json` | Execute one action and print the result |
| `kerangka dev [doc]` | Instant zero-config local runner (in-memory engine + SQLite + UIDL web preview on localhost:3000, hot reload); supports `*.kerangka.json` and `*.kerangka.yaml` |
| `kerangka serve <doc>` | Sidecar engine over HTTP/JSON and stdio JSON-RPC |
| `kerangka mcp` | MCP server for AI agents |
| `kerangka migrate <doc>` | Upgrade a document to a newer spec version |

### Developer loop

`npx kerangka init invoicing && npx kerangka dev` opens an instant zero-config local runner
with the rendered application (UIDL on React), an API explorer, an action runner that shows
the result and effects, and live diagnostics, backed by an embedded SQLite store and in-memory
engine filled from `seed`. Documents can be authored in `*.kerangka.json` or `*.kerangka.yaml`
(parsed to the identical IR). Decision tables open in a spreadsheet-like grid editor; the JSON
stays the source and is shown beside it.

### Editor support

The document JSON Schema is published at a stable URL, so VS Code and JetBrains IDEs give
autocomplete with no plugin. Later, a language server built on the compiler adds
highlighting for expression strings, go-to-definition, and inline diagnostics.

### Learning path

The north star (§2) makes learning a product feature, not only documentation.

| Level | Concepts | Built on |
|---|---|---|
| 1 | Entities, fields, validation | `todo` |
| 2 | Computed fields, rules, defs | `invoicing` totals |
| 3 | Actions and workflows | `invoicing` lifecycle |
| 4 | Permissions and row-level access | `invoicing` roles |
| 5 | Views and navigation | `invoicing` screens |
| 6 | Decision tables and time | shipping fees; `leave-request` escalation |
| 7 | Events, policies, connectors | `commerce`: ordering → billing |
| 8 | Contexts, packages, deployment | `commerce` as a monolith and as microservices |

- `kerangka learn` runs exercises: each is a document with failing examples to fix, checked
  by `kerangka test`. The same exercises run in the browser playground.
- **Concept budget:** the whole language stays within 25 concepts. The feature admission
  rule (§18) counts concepts, so a new feature must replace one or clearly earn its place.
- Documentation and error messages ship in English and Indonesian first; more languages come
  from the community.
- A usability test with people who know only JSON is part of the 1.0 exit gate (§19).

### Explain and trace

Without a way to see *why*, someone who knows only JSON gets stuck as soon as the logic is
complex.

- `run` with `trace: true` returns the evaluation trace: every guard, rule, decision row,
  and computed field, with the values that produced its result.
- `kerangka explain <doc> <action> --record r.json` prints the trace as plain sentences:
  "Guard failed: `count(lines) > 0` is false because `lines` is empty."
- The playground shows a timeline of actions, patches, events, and timers, with the state
  before and after each step.
- The trace format is specified; engines must produce it from 1.0 (conformance class
  `trace`).

### Verify

`kerangka verify` finds logic mistakes before anything runs:

| Area | Finds |
|---|---|
| Workflows | Unreachable states; dead-end states that are not final; transitions no role can run |
| Permissions | Actions no role can execute; roles that can do nothing |
| Rules and guards | Conditions that are always true or never true, where constant folding and range analysis can prove it |
| Decision tables | Gaps and overlapping rows |
| Events | Events nobody consumes; policies listening for events nobody emits |

Examples also grow into multi-step scenarios:

```json
{ "name": "invoice lifecycle",
  "steps": [
    { "run": "Invoice.create", "input": { "number": "INV-1", "customer": "c-1", "dueDate": "2026-10-31" } },
    { "run": "Invoice.update", "input": { "lines": [{ "description": "Pen", "qty": 3, "unitPrice": "0.10" }] } },
    { "run": "Invoice.send", "expect": { "events": ["InvoiceSent"] } },
    { "run": "Invoice.pay", "expect": { "record": { "status": "paid", "total": "0.30" } } }
  ] }
```

### Generated documentation

`kerangka docs` builds a static site from the model: entity-relationship diagrams, workflow
state diagrams, the context map, event flows, the API reference, and every rule and
permission written as a plain sentence ("An invoice can be sent by billing when it has at
least one line and a total above zero"). Stakeholders review the logic without reading JSON,
and the documentation cannot drift, because it is generated.

### AI authoring kit (a primary use case, not an add-on)

- **Schema for structured output.** `kerangka.schema.json` constrains document structure;
  the compiler validates the contents of shorthand and expression strings.
- **Errors designed for self-repair.** Stable `code`, JSON pointer, source line and column,
  and a one-line `hint` with a corrected example.
- **Machine-readable diagnostics (`--format=json` / LSP diagnostics).** Structured diagnostic
  payloads formatted for AI agents to parse directly and drive automated self-healing loops
  without human intervention (ADR-0029).
- **MCP server** (`kerangka mcp`) with tools `validate`, `expand`, `build`, `run_example`,
  `preview_views`, and `explain_error`.
- **An authoring skill** (a portable `SKILL.md`) with the shorthand cheat sheet and common
  patterns.
- **A change agent:** a request in plain language ("add a 10% discount for gold customers")
  becomes a pull request with the JSON diff, new examples, the contract changes from
  `kerangka diff`, and a risk summary. It is always gated by `check`, `verify`, and `test`,
  and a person approves it.
- **An evaluation set** of 50 application briefs that measures first-try validity and the
  number of repair rounds (§20); expanded in Horizon 2 into **KerangkaBench**, a public
  benchmark measuring AI code reliability against raw full-stack code.

---

## 14. Conformance suite

The conformance suite is what makes "same behaviour in every stack" true.

### Case format

```json
{
  "id": "decimal-sum-of-lines",
  "class": "compute",
  "spec": "0.1",
  "status": "active",
  "ir": "fixtures/invoicing.kir.json",
  "input": { "entity": "Invoice",
             "record": { "lines": [{ "description": "Pen", "qty": 3, "unitPrice": "0.10" }] } },
  "expected": { "record": { "total": "0.30" } }
}
```

**Classes:** `schema`, `expand`, `module` (visibility, dependencies, trait and template
expansion), `ir`, `expr`, `numeric`, `temporal`, `string`, `validate`, `compute`, `rule`,
`permission`, `action`, `transition`, `effect`, `policy`, `query`, `decision`, `timer`,
`trace`, `api-parity` (the same scenario through REST and GraphQL), `offline-replay`,
`error`, `limits`, and `project-uidl` (the projector's expected UIDL output).

### Adapter test kits

Every port (§8.1) has a test kit: store (load, save, version conflicts, outbox, timers,
sequences, `readFilter` pushdown, pagination), cache (invalidation on commit, tenant-safe
keys, rate limits), bus (at-least-once delivery, idempotent consumers), and client store
(offline outbox, rollback). An adapter — ours or a community one — is certified only when it
passes its kit, exactly as engines are certified by conformance.

### Runner protocol

Each engine ships a small executable, `kerangka-conformance`, that reads cases as NDJSON on
stdin and writes one result per line on stdout. A single harness, written in TypeScript,
runs every engine, compares results as canonical JSON (RFC 8785), and writes the
compatibility matrix. **Adding an engine means implementing the runner, not rewriting the
tests.**

### Differential fuzzing

A generator produces random valid documents, records, and inputs. Every Tier 1 engine runs
them, and any disagreement becomes a new conformance case. It runs nightly. Release gate:
zero disagreements across one million generated cases.

### Targets

| Milestone | Active cases |
|---|---|
| v0.1 | 150 (UIDL expression cases included) |
| v0.5 | 600 |
| v1.0 | 1,000 or more |

---

## 15. Repository layout

A monorepo, so the spec, the conformance suite, and every engine change together.

```
Kerangka/
├── spec/                        the contract, language-neutral
│   ├── README.md                statuses, reading order
│   ├── versioning.md
│   ├── authoring/               shorthand grammar, expression-string grammar
│   ├── schema/                  document JSON Schema, IR JSON Schema
│   └── semantics/               types, numbers, temporal, strings, expressions, rules,
│                                actions, workflows, permissions, effects, errors, limits,
│                                modules (workspace, contexts, exports, traits, templates,
│                                defs, packages), events, policies, queries, deployment
├── conformance/
│   ├── cases/<class>/*.json
│   ├── fixtures/                shared IR documents
│   ├── harness/                 TypeScript runner, matrix writer, fuzzer
│   └── PROTOCOL.md              the NDJSON runner protocol
├── compiler/                    TypeScript: parse, expand, resolve, type-check, IR, projector, emitters
├── cli/                         `kerangka` command; npm package and native binaries
├── engines/
│   ├── ts/                      @kerangka/engine
│   ├── jvm/                     kerangka-core (Java, Kotlin-friendly API)
│   ├── python/                  kerangka
│   ├── dart/                    kerangka
│   └── go/                      Go module
├── adapters/
│   ├── hono/  express/          TypeScript
│   ├── quarkus/  spring-boot/   JVM
│   ├── fastapi/                 Python
│   ├── nethttp/                 Go
│   ├── uidl-bridge/             @kerangka/uidl, kerangka_flutter
│   ├── stores/                  memory, postgres, sqlite, mysql, …; each passes the store kit
│   ├── cache/                   memory, redis (Redis and Valkey), memcached
│   ├── bus/                     in-process, database outbox, nats, kafka, redis-streams
│   ├── api/                     rest, graphql, mcp, sse, grpc
│   └── connectors/              http, sequence, email, oidc, webhooks, files, export
├── client/                      @kerangka/client and kerangka_client (Dart): cache, drafts,
│                                optimistic updates, real-time, offline outbox
├── learn/                       `kerangka learn` exercises, levels 1–8
├── rfcs/                        public proposals for spec changes (§18)
├── packages/
│   └── std/                     @kerangka/std: Money, Address, Period, auditable,
│                                softDelete, tenantScoped, approval, masterDetail,
│                                the kerangka:recommended lint preset
│   ├── accounting/              domain pack from the UIDL double-entry reference
│   └── inventory/               domain pack
├── examples/                    todo, invoicing, leave-request, inventory (single file);
│                                commerce (catalog, ordering, billing: multi-context,
│                                modular monolith and microservice topologies);
│                                the reference-application catalogue (§19)
├── docs/
│   ├── adr/
│   └── guides/
└── .github/workflows/           one CI matrix across every language
```

Swift Package Manager requires `Package.swift` at a repository root, so a future Swift engine
lives in its own `kerangka-swift` repository and consumes the conformance suite from
release artifacts.

---

## 16. Packaging and distribution

| Language | Packages | Registry | Publishing |
|---|---|---|---|
| TypeScript | `kerangka` (CLI and compiler), `@kerangka/engine`, `@kerangka/uidl`, `@kerangka/client`, `@kerangka/hono`, `@kerangka/express` | npm | GitHub Actions with npm provenance |
| JVM | `kerangka-core`, `kerangka-quarkus`, `kerangka-spring-boot-starter` | Maven Central; groupId `io.github.hi-donwi` (verifiable through GitHub), or `dev.kerangka` if that domain is registered | Central publishing, signed artifacts |
| Python | `kerangka`, with a `kerangka[fastapi]` extra | PyPI | Trusted Publishing (OIDC) |
| Dart | `kerangka`, `kerangka_flutter` | pub.dev | Automated publishing from GitHub Actions (OIDC) |
| Go | `github.com/hi-donwi/kerangka/engines/go` | Go module proxy | Tags `engines/go/vX.Y.Z` |
| CLI binaries | `kerangka-<os>-<arch>` | GitHub Releases, a Homebrew tap, Scoop | Signed, with checksums |
| Sidecar image | `ghcr.io/hi-donwi/kerangka` | GitHub Container Registry | Multi-architecture |

If the `@kerangka` npm organisation is unavailable, the scoped packages fall back to
`kerangka-engine`, `kerangka-uidl`, and so on.

Store, cache, bus, API, and connector adapters are separate packages per language
(`@kerangka/store-postgres`, `kerangka-store-postgres` on the JVM, …), so a service installs
only what its infrastructure profile uses.

**Kerangka packages** (types, traits, templates, defs, view templates, lint presets) are
folders with their own `kerangka.json`. They are published to npm or referenced by a git
URL and tag, pinned in `kerangka.lock`, and resolved by the compiler only. Teams on other
stacks never need them at run time, because the IR they deploy is already flat.

**Version policy.** Every package shares `major.minor` with the spec version it
implements; patch numbers are independent per package.

**Supply chain.** An SBOM for each release, build provenance attestations, pinned CI
actions, and a security gate in CI (for example Agent-Secure).

---

## 17. Security model

Documents may be generated by AI or supplied by tenants, so **every document is untrusted
input**.

| Threat | Control |
|---|---|
| Code execution | No `eval`, no dynamic imports, no reflection. Extensions are an allowlist registered by host code; a document naming an unregistered extension fails at load with `UNKNOWN_EXTENSION`. |
| Unbounded work | Caps on document size, node count, expression depth (64), list size, and a step budget per `run` → `LIMIT_EXCEEDED`. No loops, so evaluation always terminates. |
| ReDoS | RE2-compatible pattern subset only. |
| Trusting the UI | Permissions are enforced by the engine on the server; UIDL visibility is cosmetic. Adapters call `run` server-side for every write; conformance tests the forbidden paths. |
| Row-level leaks | `readFilter` predicates are pushed into queries by adapters. The SQL adapter uses parameterised queries only and never concatenates document content into SQL. |
| Mass assignment | `set` from input is limited to declared input fields. Computed and system fields (`id`, `version`, audit fields) are never writable from input. |
| Exposed sidecar | Binds to loopback by default; a token is required on any other interface; CORS off by default. |
| Secrets | Never in documents. Extension configuration comes from the host environment. |
| Server-side request forgery | Connectors allowlist hosts and block private network ranges by default. |
| Webhooks | Outgoing webhooks are signed with HMAC; incoming webhooks are rejected unless their signature verifies. |
| GraphQL abuse | Depth and cost limits, batching against N+1, `readFilter` applied in every resolver. |
| Cache leaks | Cache keys include the applied `readFilter`, so cached results never cross tenants or roles (§8.5). |
| Offline data | Only entities declared `offline` reach devices; `sensitive` fields never do; stores are cleared on logout and encrypted where the platform allows. |
| AI agents over MCP | Tools run as the calling actor, with the same permissions as any other API. |
| Personal data | `personal` fields are masked in logs, traces, and error messages; every committed action lands in an append-only audit trail; export and erasure automation follows in Horizon 2. Kerangka provides mechanisms for regulations such as Indonesia's UU PDP or the GDPR; compliance remains the operator's responsibility. |

`SECURITY.md` with a private disclosure channel ships in Phase 0; an external-style
security review happens before 1.0.

---

## 18. Versioning, governance, and the path to a standard

- **Document version.** Every document declares `"kerangka": "major.minor"`. Before 1.0 a
  minor version may break, with `kerangka migrate` to upgrade. From 1.0, minor versions are
  additive only; a major version breaks, with an automated migration.
- **IR version.** The IR carries its own `irVersion`; engines accept a declared range and
  reject others with `UNSUPPORTED_VERSION`.
- **File statuses** in `spec/`: Planned → Draft → Approved → Deprecated, the same model as
  UIDL. Changing an Approved file requires an ADR.
- **Feature admission rule** — the complexity budget that keeps Kerangka from turning into
  a bad programming language. A new document feature needs:
  1. three real example applications that need it;
  2. conformance cases;
  3. an implementation in the TypeScript engine;
  4. a note on how each Tier 1 engine implements it;
  5. an argument that an extension handler cannot do the job well;
  6. a place in the concept budget (§13): at most 25 concepts in the whole language.
- **Organisation standards** travel as packages (§7.5): required traits, naming rules,
  complexity budgets, API conventions, and view templates, adopted with one `extends` line
  and upgraded like any dependency.
- **Licences:** Apache-2.0 for code and CC BY 4.0 for the specification text (see "Path to a
  standard" below and ADR-0007).
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md` ship in Phase 0.


### Path to a standard

A format becomes a standard when several independent parties implement it and trust how it
is governed. Kerangka plans for that from the start.

| Stage | What it takes | When |
|---|---|---|
| 1. Open specification | The spec in `spec/`, public RFCs, ADRs, the conformance suite, and one reference implementation | From Phase 0 |
| 2. Several implementations | Five Tier 1 engines; then at least two engines and five adapters built outside the core team, all certified | 1.0, then Horizon 2 |
| 3. Shared stewardship | A steering group with members from at least three organisations; published governance and trademark policies | Horizon 2 |
| 4. Neutral home | An application to a foundation, for example the OpenJS Foundation or the Linux Foundation | Horizon 3, once stage 3 holds and 1.x has been stable for a year |

- **Licences suited to a standard.** Code under Apache-2.0, whose explicit patent grant
  matters to companies and to other implementers; the specification text under CC BY 4.0,
  so anyone may implement, translate, and republish it (ADR-0007).
- **Public RFCs.** Every change to the spec starts as `rfcs/NNNN-title.md`: problem,
  proposal, examples, conformance impact, impact on each engine, concept-budget impact, and
  alternatives. After an open comment period, an accepted RFC becomes an ADR and a spec
  change. Horizon 2 and 3 items enter the roadmap only through accepted RFCs (ADR-0027).
- **A name that means something.** "Kerangka" and the "Kerangka Compatible" badge are
  governed by a trademark policy; the badge requires a published, passing conformance run.
  Registering the name before 1.0 is worth considering.

### Sustainability

A standard with five engines and dozens of adapters cannot rest on one person's spare time.
Before 1.0, decide how the work is funded. Options that keep the core open: sponsorship,
paid support and training, developer certification, a revenue share on the Hub, and — as a
Horizon 3 option — a hosted Kerangka Cloud. The specification, the conformance suite, and
the Tier 1 engines stay open source whichever option is chosen.

---

## 19. Roadmap

Every phase ends with an exit gate. Durations assume one maintainer working with AI agents;
treat them as sizing, not commitments. The roadmap has three horizons: **Horizon 1** is
v1.0 (Phases 0–6, roughly ten months); **Horizon 2** (v1.x) grows reach and the ecosystem;
**Horizon 3** (v2.0) is the platform and the neutral standard. Horizon 1 scope is frozen;
Horizon 2 and 3 items enter only through accepted RFCs (ADR-0027).

Two rules keep the Horizon 1 estimate honest:

- **Core before breadth.** Modularity (Phases 1–2) and the ports (Phase 2) come early,
  because they shape the IR and every adapter. More databases and protocols arrive later as
  adapters behind those ports.
- **Stretch items never block a gate.** An item marked *(stretch)* moves to a 1.x release if
  its phase runs late.

### Phase 0 — Foundations (1–2 weeks)

- Reserve the name on every registry; create the GitHub repository with a `main`
  protection ruleset; add the licences (Apache-2.0 for code, CC BY 4.0 for spec text),
  `SECURITY.md`, `CONTRIBUTING.md`, and `GOVERNANCE.md`; open the public `rfcs/` process.
- Draft ADR-0001 to ADR-0032 (§22).
- **Write the example applications by hand before any code:** `todo` (smallest),
  `invoicing` (computed totals, workflow), `leave-request` (approval chain, a decision table
  for approver routing, a three-day escalation timer), `inventory` (stock movements,
  row-level permissions), and `commerce` (three contexts, cross-context events and
  policies, traits from a shared package, and deployment topologies).
- Choose the reference-application catalogue — 8 to 10 domains such as invoicing, HR leave,
  inventory, booking with capacity, CRM, helpdesk, subscriptions, and purchase approval —
  and write the protocol for the learner usability test.
- Create the `spec/` skeleton with status lines.

**Exit gate:** examples reviewed; each single-file example under 150 lines and each
`commerce` file under 300; catalogue and test protocol agreed; ADRs accepted.

### Phase 1 — Spec core, modules, and compiler → v0.1 (4–5 weeks)

- Document JSON Schema, shorthand grammar, expression-string grammar, formal EBNF in `spec/k1.ebnf`.
- YAML authoring support (`*.kerangka.yaml` compiled to identical IR).
- Semantics files at Draft: types, numbers, temporal, strings, expressions, rules,
  computed fields, errors, and modules (workspace, contexts, exports, dependencies,
  traits, templates, defs).
- IR JSON Schema v0.1 (flat: no modules survive compilation).
- Compiler: load workspaces and single files, parse with source positions, validate,
  expand shorthand, traits, templates, and defs, check the boundaries in §7.4, resolve,
  type-check, annotate numeric kinds, detect cycles, emit IR.
- CLI: `init`, `add`, `check`, `lint` (boundaries, naming, complexity budgets), `expand`,
  `build`, `test`, `graph`, `stats`.
- TypeScript engine: `load`, `validate`, `compute`.
- Conformance harness and at least 150 cases, UIDL's expression cases and the `module`
  class included.

**Exit gate:** every example compiles, `commerce` included; `kerangka lint` passes on every
example with the recommended preset; every error carries code, pointer, line, column, and
hint; 100% conformance in TypeScript.

### Phase 2 — Actions, events, decisions, time, and ports → v0.2 (7–8 weeks)

- Semantics at Draft: actions, workflows, permissions, effects, events, policies, queries,
  decision tables, schedules and timers, effective-dated rules (§5.12), invariants (§5.13),
  first-class multi-tenancy discriminator strategy (§5.14), portable Wasm extension interface
  in IR (§5.10, ADR-0030), packages, limits.
- Events in the CloudEvents envelope; expand/contract zero-downtime rules in `kerangka diff` (ADR-0032).
- TypeScript engine: `can`, `available`, `plan`, `run` (with `trace`), `readFilter`,
  `queryPlan`, `react`, `decide`, `schedules`.
- Ports specified, each with its test kit (§8.1, §14); defaults that need only the
  database.
- Stores: memory, PostgreSQL, SQLite. Bus: in process and database outbox. Scheduler:
  database timer table.
- Connectors: `http`, `sequence`, `email`.
- Package resolution and `kerangka.lock`; the first `@kerangka/std` release (Money,
  Address, Period, auditable, softDelete, tenantScoped, approval, the recommended lint
  preset).
- `kerangka serve` (HTTP/JSON and stdio JSON-RPC) and its container image.
- REST projection with RFC 9457 errors and idempotency keys; emitters for JSON Schema,
  OpenAPI 3.1, AsyncAPI 3.0, and PostgreSQL and SQLite DDL.
- Hono adapter.
- CLI: `run`, `emit`, `diff`, `verify`, `db diff` (plain SQL), `decisions import | export`.

**Exit gate:** every example runs end to end through the sidecar and through the Hono
adapter on the **Starter profile** (one database, nothing else); `commerce` runs as a
modular monolith with policies across contexts; `leave-request` routes by decision table and
escalates by timer; a non-JavaScript client drives the invoicing workflow; `kerangka diff`
catches a deliberately breaking event change; `kerangka verify` finds a planted dead-end
state and a planted decision-table gap.

### Phase 3 — Frontend, client state, learning, and the AI kit → v0.3 (6–7 weeks)

- UIDL projector: list, form, detail, dashboard, scaffold mode, and a navigation shell
  composed from context-owned views; view templates from packages.
- `@kerangka/uidl` handler bridge; `@kerangka/client` with a cache fed by action patches,
  optimistic updates with rollback, and draft persistence in IndexedDB.
- Real-time over server-sent events (one instance).
- `oidc` connector.
- `kerangka dev` playground with the action timeline and trace view; `kerangka explain`;
  `kerangka docs`.
- `kerangka learn` levels 1–5; messages in English and Indonesian.
- MCP projection: exported actions and queries as tools for AI agents, with permissions
  enforced.
- Upstream proposals to UIDL for anything missing (for example the K1 expression
  operators and per-row aggregates).
- AI kit: `kerangka mcp` (authoring), the authoring skill, the change agent (§13), machine-readable
  diagnostics (`--format=json` / LSP) for automated agent self-healing, and the evaluation set with baseline scores.
- Instant zero-config `kerangka dev` (embedded SQLite + in-memory engine + hot reload on localhost:3000).
- The decision-table grid editor in the playground.

**Exit gate:** `npx kerangka dev examples/invoicing` runs a complete web application from
one JSON file, with optimistic updates and live updates across two browser windows; an AI
agent completes the invoicing workflow through MCP without extra permissions; the LLM
evaluation baseline is recorded.

### Phase 4 — JVM, Python, microservices, and the Standard profile → v0.4 (8–9 weeks)

- `kerangka-core` (Java with a Kotlin-friendly API), Quarkus extension, Spring Boot starter.
- Python engine and FastAPI adapter.
- Differential fuzzing across TypeScript, JVM, and Python.
- Typed model generation: TypeScript types, Java records, Python dataclasses or Pydantic
  models; typed clients generated from each context's exported contract.
- Deployment file, `kerangka build --topology … --service …`, and cross-service event
  delivery through the outbox.
- `kerangka diff --check-breaking` gate in CI for zero-downtime rolling upgrades; expand/contract
  database migration generation.
- Cache port on Redis and Valkey: query cache, rate limits, idempotency keys, and real-time
  fan-out across instances.
- MySQL / MariaDB store; migrations in Flyway and Alembic formats; `kerangka db import` and
  legacy table mappings.
- GraphQL projection; `webhook-out` and `webhook-in`; `files` connector (S3-compatible).
- OpenTelemetry in every adapter.

**Exit gate:** 100% conformance on three engines; zero disagreements across one million
fuzz cases; the `commerce` example deployed twice from the **same, unchanged model** — as one
service on the Starter profile, and as three services on three stacks (Hono, Quarkus,
FastAPI) on the Standard profile — behind the same UIDL frontend; the `api-parity` class
passes for REST and GraphQL; every shipped adapter passes its test kit.

### Phase 5 — Dart, Go, mobile, offline, human tasks, and the Distributed profile → v0.5 (7–8 weeks)

- Dart engine, `kerangka_flutter`, and the Dart client.
- Go engine and `net/http` adapter.
- Verify the JVM engine on Android (§21, R8).
- Offline: client SQLite and IndexedDB stores, the offline outbox, and action replay with
  conflict policies.
- The first message-broker adapter (NATS or Kafka, chosen by demand); a Redis Streams bus
  *(stretch)*.
- Projections: read models built from events, for heavy reads across contexts.
- `export` connector; SQL Server store *(stretch)*; MongoDB store *(stretch)*; gRPC
  projection *(stretch)*; `notify` connector *(stretch)*.
- Human tasks and the generated inbox (§5.11), with delegation and SLA escalation.
- `messages` (i18n); `kerangka learn` levels 6–8.

**Exit gate:** five Tier 1 engines at 100%; a Flutter application works offline, syncs, and
resolves a deliberate conflict with the declared policy; `commerce` runs on the Distributed
profile with a broker; a leave request reaches the right manager's inbox and escalates when
its SLA expires.

### Phase 6 — Hardening and reach → v1.0 (5–7 weeks)

- Semantics files move to Approved; spec 1.0 is frozen; the trace format becomes required.
- Documentation site: guides, reference generated from `spec/`, compatibility matrix.
- Security review; performance budgets enforced in CI; `kerangka migrate` from 0.x to 1.0.
- The reference-application catalogue completed; a public load benchmark of `commerce` on
  each infrastructure profile.
- The learner usability test with people who know only JSON.
- Spreadsheet import (Excel and CSV): sheets become entities, formulas become computed
  fields, lookup sheets become decision tables.
- Privacy by model, first part: `personal` fields masked in logs, traces, and errors; an
  append-only audit trail of every committed action.
- Infrastructure projection: `kerangka emit compose | k8s` (Docker Compose; Kubernetes
  manifests with autoscaling).
- The first two domain packs: `accounting` (from the UIDL double-entry reference) and
  `inventory`.
- The funding decision (§18) and the "Kerangka Compatible" badge, granted from published
  conformance runs.
- Tier 2 contributor guides: "Write an engine in your language" and "Write an adapter",
  using the runner protocol and the test kits.

**Exit gate:** v1.0.0 published on every registry on the same day; the invoicing
spreadsheet imports into a running application; the north-star metrics (§20) met, or the
gap published with a plan rather than hidden.

### Horizon 2 — v1.x: reach and ecosystem

Items enter through accepted RFCs; many are well suited to community contributors.

**Reach**

- Importers beyond spreadsheets: OpenAPI, JSON Schema, Prisma, JHipster JDL, BPMN (to
  workflows and human tasks), and DMN (to decision tables).
- **Kerangka Hub:** a registry for packages, connectors, templates, and domain packs, with
  search, ratings, and certification badges.
- **Domain packs** beyond `accounting` and `inventory`: HR, point of sale, clinic, school,
  CRM, helpdesk, subscriptions, purchasing.
- **Incremental adoption kits:** run one Kerangka module inside an existing Spring, Laravel,
  Rails, or Express application (the strangler pattern), with guides.
- **Integration projections:** n8n, Zapier, and Make nodes generated from exported actions,
  queries, and events.
- **Community programme, Indonesia first:** university, vocational-school (SMK), and
  bootcamp curricula; developer certification; hackathons; starter packs for small
  businesses (UMKM); regional connector packs such as local payment gateways, WhatsApp
  notifications, and e-invoicing formats, mostly community-built.

**Capabilities**

- **Governed rule publishing:** draft → review → publish → roll back for rules and decision
  tables, without redeploying code; per-tenant model versions.
- **Privacy automation:** data-subject export and erasure, retention jobs, and field-level
  encryption for `personal` data.
- **Relationship-based permissions (ReBAC),** with an adapter for Zanzibar-style systems
  such as OpenFGA.
- **Search projection:** searchable fields declared in JSON; PostgreSQL full text first,
  then Meilisearch and OpenSearch adapters.
- **Documents and analytics:** printable documents (invoices, letters) through UIDL document
  artifacts; `metrics` declared in JSON that become dashboards, SQL, and API endpoints; event
  export to data warehouses.
- **Runtime AI steps:** an `ai` connector for classification, extraction, and summaries,
  with schema-validated output treated as untrusted input; low-confidence results route to
  a human task.
- **Infrastructure projection** beyond Compose and Kubernetes: Helm charts and serverless
  targets.
- **`kerangka simulate`:** thousands of virtual users running random valid actions to find
  invariant violations, stuck workflows, and hot spots; load-test scripts generated from
  the model.
- **Wasm runtime runner:** sandboxed execution of WebAssembly extensions across all five Tier 1 engines (ADR-0030).
- **Advanced multi-tenancy:** schema and database isolation strategies, plus Tenant Overlays for runtime customization without forking (ADR-0031).
- **KerangkaBench:** public benchmark measuring AI coding accuracy on Kerangka vs raw code.

**Carried over from the earlier post-1.0 list:** a Rust core compiled to WebAssembly; full
code generation ("eject"); multi-device sync beyond action replay; multi-tenant overlays; an
event-sourcing adapter; business-day calendars; GraphQL federation; more community
adapters certified by the test kits; editing Kerangka views inside UIDL-Builder.

**Horizon 2 targets:** at least two engines and five adapters built outside the core team
and certified; ten domain packs on the Hub; a steering group with members from three
organisations.

### Horizon 3 — v2.0: platform and standard

Decided on adoption data, not in advance.

- **Kerangka Studio:** full visual editing of contexts, aggregates, workflows, decision
  tables, and views, always with the JSON side by side as the source of truth, so the
  Studio teaches JSON rather than hiding it.
- **Neutral governance:** the foundation application (§18).
- **A hosted offering** (Kerangka Cloud), if the funding decision chooses it (§18).
- **Spec 2.0,** shaped by what 1.x adoption teaches.

---

## 20. Success metrics

| Metric | Target | Measured |
|---|---|---|
| **North star: no host code** | At least 90% of reference applications need no host code | Reference-application catalogue, counted per release |
| **North star: learnable** | A learner who knows only JSON builds the invoicing application in one day after the tutorial | Usability test before 1.0 |
| Time from `npx kerangka init` to a running app with CRUD and a workflow | Under 5 minutes | Scripted walkthrough per release |
| Size of the invoicing example | Under 100 lines of JSON | `wc -l` in CI |
| Conformance | 100% of active cases on every certified engine | Compatibility matrix |
| Cross-engine agreement | Zero disagreements across 1M fuzz cases | Nightly fuzz job |
| LLM authoring, first try | 90% or more of generated documents valid, with schema-constrained output | Evaluation set, 50 briefs |
| LLM authoring, after one repair | 98% or more valid | Same evaluation set |
| `run` latency, in-process | p95 under 1 ms for the example applications | Benchmarks in CI |
| Compile time | Under 1 s for a 500-entity document | Benchmarks in CI |
| Browser engine size | Under 30 KB minified and gzipped | Bundle-size check in CI |
| New engine effort | 3,000 lines or fewer for a Tier 1 engine | Line count per engine |
| Monolith to microservices | Zero changes to model files when `commerce` moves from one service to three | Phase 4 exit gate, then in CI |
| Complexity budgets | Every example passes the `kerangka:recommended` lint preset | CI |
| Largest file | Under 300 lines in every example | CI |
| Context isolation | Each `commerce` context builds and tests alone | One CI job per context |
| Starter profile | Every example runs on one database and nothing else | CI |
| Profile switch | Starter → Standard → Distributed with zero model changes | CI on `commerce` |
| API parity | REST and GraphQL give identical results for every `api-parity` case | Conformance |
| Adapter certification | Every shipped adapter passes its test kit | CI |
| Offline replay | Every `offline-replay` case matches the server result or the declared conflict policy | Conformance |
| Spreadsheet to running application | Under 30 minutes for the invoicing spreadsheet | Scripted walkthrough per release |
| Without AI | Every `kerangka learn` level completed without an AI assistant | Usability test |
| Zero-downtime migration | A model change with expand/contract completes with zero failed client requests | Automated rolling deployment test |
| Invariant integrity | Invariants hold across 100,000 simulated random actions | `kerangka simulate` |
| Independent implementations (Horizon 2) | At least two engines and five adapters built outside the core team, certified | Compatibility matrix |

---

## 21. Risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Scope explosion** — "every stack" never ends | Tiers; the sidecar and standard contracts give day-one coverage; native engines only when conformance is in place; certification instead of promises |
| R2 | **Semantic drift** between languages (numbers, dates, strings, regex, ordering, null) | Typed numeric IR; decimal-as-string; code-point strings; RE2 subset; RFC 8785; differential fuzzing |
| R3 | **Inner-platform effect** — the JSON grows into a bad programming language | Hard non-goals; extension handlers as the escape hatch; the feature admission rule (§18) |
| R4 | **Confusion with UIDL** | A written ownership boundary (§4); Kerangka never renders, UIDL never decides business outcomes; gaps are fixed in UIDL |
| R5 | **Single-maintainer load** across five languages | Small engines (≤ 3,000 lines); one compiler; tests are data, not code; AI agents port engines against the conformance suite |
| R6 | **Untrusted documents** | §17; security review before 1.0 |
| R7 | **Adoption** | Zero-config scaffolding; the `dev` playground; examples that look like real work; AI authoring kit |
| R8 | **Android compatibility** — server adapters target Java 21, but Android's toolchain may not accept all Java 21 bytecode or APIs | Verify in Phase 5; if needed, compile `kerangka-core` to an older bytecode level while adapters stay on 21, recorded in an ADR |
| R9 | **Decimal libraries differ** in edge cases (rounding, scale, negative zero) | Numeric conformance class written first; wrapper per engine that normalises results |
| R10 | **UIDL cannot absorb the K1 extensions** in time | Ship K1 under a `kx:` namespace in Kerangka's IR until UIDL accepts it; the UIDL projector avoids K1 in UI expressions until then |
| R11 | **"UIDL" is ambiguous**: TeleportHQ publishes an unrelated, active "UIDL Standard" (`@teleporthq/teleport-uidl-validator`) | Kerangka docs always link UIDL to its repository and never say "the UIDL standard" unqualified; the UIDL project decides separately whether to act on the collision |
| R12 | **Distributed monolith**: services split too early or too finely, with chatty synchronous calls | Modular monolith by default; split only for a stated reason (§7.6); a budget of four structural dependencies per context; `kerangka graph` in reviews; lint warns on synchronous loads across services |
| R13 | **Eventual-consistency surprises** for teams new to events | Policies are idempotent by design; documented saga patterns with compensating actions; `kerangka dev` shows the event flow; `commerce` demonstrates it |
| R14 | **Reuse turns into indirection**: traits and templates hide too much | Values-only templates; no silent trait overrides; `kerangka expand` shows the flattened result; budgets count expanded content |
| R15 | **Modularity delays the first release** | Single-file documents stay first-class; the module system is limited to the rules in §7.4; registry features beyond npm and git are deferred |
| R16 | **Scope growth**: databases, caches, protocols, offline, and connectors on top of five engines | Core before breadth; stretch items never block a gate (§19); adapters are small packages behind fixed ports; community adapters certified by test kits |
| R17 | **Cache inconsistency** | The database is the only source of truth; every write checks `version`; invalidation on commit; bounded TTLs; the cache is optional |
| R18 | **Offline conflicts confuse users** | Action replay with full validation; `reject-and-review` by default; the conflict screen shows what changed |
| R19 | **Generated migrations lose data** | `renamedFrom`; destructive steps fail CI without explicit approval; `kerangka db diff` lists destructive steps first |
| R20 | **"JSON only" hits a wall** | Decision tables, time, and connectors push the wall back; the escape ladder (§5.10) keeps the last step small and typed; the no-host-code metric measures the wall instead of assuming it away |
| R21 | **Ambition dilutes focus**: every good idea lands in 1.0 | Horizons; Horizon 1 scope frozen; Horizon 2 and 3 only through accepted RFCs; stretch items never block a gate |
| R22 | **A standard controlled by one person is not trusted** | Public RFCs from Phase 0; CC BY spec text; independent certified implementations; the stewardship stages in §18 |
| R23 | **AI-generated models look plausible but are wrong** | Examples required; `verify` and `simulate`; the change agent shows contract changes and a risk summary; a person approves every change |
| R24 | **Rule changes without deployment become a production risk** (Horizon 2) | Review and approval before publish; effective dates; audit; one-step rollback; `verify` and examples as publish gates |
| R25 | **Compliance over-claimed** | Kerangka documents which mechanisms it provides (masking, audit, export, erasure) and which obligations stay with the operator |
| R26 | **Wasm runtime differences across host languages** | Conformance test suite covers Wasm extensions; target WebAssembly Core 2.0 / Component Model MVP; fallback to host stub if runtime missing |
| R27 | **Tenant data leakage in complex queries or custom connectors** | Engine automatically injects tenant filter at the store port boundary before query compilation; conformance suite includes cross-tenant assertion cases |

---

## 22. Decisions to record as ADRs

| ADR | Proposed decision | Alternatives considered |
|---|---|---|
| 0001 | Frontend output is UIDL; no second UI language | Own UI schema; JSON Forms |
| 0002 | A canonical IR; one compiler, in TypeScript; engines read IR only | A compiler per language; a Rust compiler first |
| 0003 | Expressions: UIDL AST, an infix string syntax, and the K1 extension set | CEL; JSON Logic; a JavaScript subset |
| 0004 | Numeric and temporal model: safe-range `int`; decimal as string, ≤ 28 digits, HALF_EVEN; UTC instants; code-point strings; RE2 subset | Floats everywhere; locale-aware comparison |
| 0005 | Engines are pure; I/O only as effects; external data through `plan` and `uses` | Engines calling repositories directly |
| 0006 | Monorepo; lockstep `major.minor` across languages | One repository per language |
| 0007 | Apache-2.0 for code, CC BY 4.0 for the specification text (a standard needs an explicit patent grant and a freely republishable spec) | MIT, as UIDL |
| 0008 | Fail-closed rules, guards, and permissions | Treating `null` as passing |
| 0009 | Bounded contexts are the unit of modularity: exports, id-only cross-context references, acyclic structural dependencies | One global namespace governed by conventions |
| 0010 | An action changes one existing aggregate; other aggregates change through events and policies | Multi-aggregate transactions; distributed transactions |
| 0011 | Reuse is compile-time: traits, values-only templates, defs, and packages are flattened into the IR | Modules resolved by every engine; inheritance between entities |
| 0012 | Deployment topology lives in its own file; modular monolith by default | Topology inside the model; one service per context by default |
| 0013 | Kerangka packages are distributed through npm or git and pinned in `kerangka.lock` | A dedicated Kerangka registry |
| 0014 | Decision tables are first-class: a DMN-style subset with cell tests, hit policies, and fail-closed results | Nested `if` expressions only; full DMN with FEEL |
| 0015 | Time is an input: schedules and timers are declared in the model and fired by the scheduler port; engines never wait | Timers inside engines; cron jobs outside the model |
| 0016 | Connectors are declarative, allowlisted, and reference secrets; code extensions are the last rung | Code handlers for all I/O |
| 0017 | Ports and adapters with database-only defaults; caches such as Redis, buses, and client stores are never the source of truth | Redis or a broker as required infrastructure |
| 0018 | Layered state: UIDL owns UI state; the Kerangka client owns cache, drafts, and offline; offline replays actions, not diffs | A client state library per framework; diff-based sync |
| 0019 | Relational default: one row per aggregate root, scalar columns, embedded lists as JSON; child tables opt-in | Fully normalised tables by default |
| 0020 | One model, many API projections: REST by default, plus GraphQL, MCP, SSE, gRPC; RFC 9457 errors; parity tested | REST only; hand-written GraphQL resolvers |
| 0021 | Migrations are generated from model diffs, with `renamedFrom` and explicit approval for destructive steps | Hand-written migrations only |
| 0022 | Effective-dated rules and decision tables; the effective date is an explicit input | Replacing rules in place; clock-dependent evaluation |
| 0023 | Events use the CloudEvents envelope | A Kerangka-specific envelope |
| 0024 | Human tasks are declared on workflow states; the inbox is a generated query and view | A separate BPM engine |
| 0025 | Privacy by model: `personal` and `sensitive` field classes drive masking, audit, offline rules, and later data-subject automation | Privacy handled only in host code |
| 0026 | Every feature is usable without AI; AI tooling is an accelerator, never a dependency | AI-first features without a manual path |
| 0027 | Three horizons; Horizon 1 scope is frozen; Horizon 2 and 3 items enter only through accepted RFCs | One growing roadmap |
| 0028 | The path to a standard: open spec, public RFCs, independent implementations, shared stewardship, then a foundation | Remaining a single-vendor format |
| 0029 | Formal invariants on aggregates and machine-readable diagnostics for AI self-healing | Relying solely on action guards and untyped error strings |
| 0030 | WebAssembly (Wasm Component Model) as the portable extension escape hatch | Host-specific language stubs only, breaking cross-stack portability |
| 0031 | First-class multi-tenancy (`discriminator`, `schema`, `database`) and tenant overlays | Ad-hoc manual query filters |
| 0032 | Zero-downtime schema evolution via expand/contract semantics and breaking-change verification | Destructive in-place migrations requiring downtime |

**On CEL (ADR-0003).** Google's Common Expression Language is the strongest alternative:
mature, intentionally not Turing-complete, with official implementations in Go, Java, and
C++. It loses here because the UIDL renderers on React, Flutter, and Android already
evaluate the UIDL grammar under a shared conformance suite; adopting CEL would mean two
expression languages across UI and logic. Revisit if K1 grows beyond about 25 operators.

---

## 23. First ten tasks

1. Reserve the accepted name on npm, PyPI, pub.dev, crates.io, NuGet, RubyGems, and as a
   GitHub organisation; check the `@kerangka` npm scope and domains.
2. Create the `hi-donwi/Kerangka` GitHub repository with the `main` protection ruleset,
   the Apache-2.0 and CC BY 4.0 licences, `SECURITY.md`, `GOVERNANCE.md`, and `rfcs/`.
3. Write ADR-0001 to ADR-0032.
4. Write `examples/todo`, `invoicing`, `leave-request`, `inventory`, and the multi-context
   `commerce` as JSON by hand.
5. Draft `spec/semantics/types.md`, `numbers.md`, `expressions.md`, and `modules.md`.
6. Write the IR JSON Schema v0.1.
7. Build the compiler skeleton: parse with source positions, validate against the
   schema, and report errors with code, pointer, and position.
8. Build the conformance harness and the first 50 cases, starting with `numeric`.
9. Implement `load`, `validate`, and `compute` in the TypeScript engine.
10. Run `kerangka check` and `kerangka test` on every example in CI.

---

## Appendix A — Prior art

| Project | What it covers | How Kerangka differs |
|---|---|---|
| JSON Schema, JSON Forms, react-jsonschema-form | Data shape and forms | Adds rules, actions, workflows, and permissions; engines in many languages |
| TeleportHQ UIDL Standard and `teleport-code-generators` | A JSON UI description converted to React, Vue, Web Components, and other code | UI only and generation only; Kerangka covers logic, runs as well as generates, and is verified by conformance. It is also a *different* UIDL from the one Kerangka emits (§21, R11) |
| JSON Logic | Portable rule expressions | A whole application model, typed decimals, a conformance suite |
| CEL | Portable expressions | See ADR-0003 |
| XState, SCXML | State machines | Workflows are one part, integrated with data and permissions |
| OpenAPI, TypeSpec, Smithy | API contracts and code generation | Kerangka *emits* OpenAPI; contracts are an output, not the model |
| Prisma schema | Data model and a typed client | No rules or UI; TypeScript-centred |
| Keel, Wasp, Amplication | Schema or DSL to backend or full application | Plain JSON (AI-friendly), pure multi-language engines, no hosted platform |
| Budibase, Appsmith, Retool | Low-code builders | Document-first and embeddable in your own stack |
| Temporal | Durable workflow execution | Kerangka workflows are record state machines, not long-running processes |
| JHipster JDL | A DSL for entities, relationships, applications, and microservice deployments that generates Spring Boot plus Angular, React, or Vue code | Kerangka adds rules, workflows, and permissions, runs as well as generates, and is not tied to one backend stack |
| DMN (Decision Model and Notation) | A standard for decision tables and the FEEL expression language | Kerangka adopts a small subset of decision-table ideas (cell tests, hit policies) and keeps one expression language |
| Replicache, PowerSync, ElectricSQL | Local-first sync between client and server | Kerangka's offline replay follows Replicache's idea of re-running client mutations on the server; here each mutation is a Kerangka action checked by the same engine |
| PostgREST, Hasura | REST or GraphQL APIs generated from a database schema | Kerangka generates APIs from the domain model, so rules and permissions hold on every protocol |
| TanStack Query | Server-state caching in web clients | The Kerangka client also caches by query and id, but updates from action patches and runs the engine for optimistic updates |
| Camunda, Flowable | BPMN process engines with human tasks | Kerangka's tasks belong to a record's workflow rather than a separate process engine; BPMN import is a Horizon 2 item |
| Glide, AppSheet | Applications built from spreadsheets | Kerangka imports the spreadsheet once; from then on the JSON model is the source, with rules, workflows, and any stack |
| Context Mapper | A DSL for DDD strategic design: bounded contexts and context maps | Kerangka's contexts are executable, not only descriptive; `kerangka graph` draws the map from the model |

## Appendix B — Glossary

| Term | Meaning |
|---|---|
| Document | The author-facing `*.kerangka.json`; shorthand allowed |
| Workspace | A multi-file application: `kerangka.json`, its contexts, and its packages |
| Context | A bounded context: a folder with its own language, exports, and dependencies |
| Aggregate | A root entity plus its embedded entities; the unit of consistency and of one transaction |
| Trait | A reusable bundle of fields, rules, defaults, read filters, and permissions |
| Def | A named, non-recursive pure expression, inlined by the compiler |
| Template | A parameterised fragment (workflow, action, view); values only |
| Policy | A reaction: when an event happens, run an action |
| Query | A named, paginated read executed by adapters |
| Package | A versioned bundle of reusable types, traits, defs, templates, and lint presets |
| Topology | Which contexts run together in which service (`deploy.kerangka.json`) |
| IR | Canonical intermediate representation (`*.kir.json`); explicit, typed, versioned; the only input engines accept |
| Engine | A pure library that evaluates IR in one language |
| Adapter | An implementation of a port for one technology (PostgreSQL, Redis, NATS, …), or framework glue for HTTP routes and authentication |
| Port | One of the fixed interfaces between a host and its infrastructure: store, cache, bus, scheduler, realtime, files, connectors, secrets, telemetry, client store (§8.1) |
| Infrastructure profile | Starter, Standard, or Distributed (§8.7) |
| Projection | Anything generated from the IR: screens, APIs, DDL and migrations, contracts, documentation |
| Decision table | Rows of cell tests and results, evaluated by a hit policy (§5.8) |
| Schedule | A recurring action declared with `cron` (§5.9) |
| Timer | A delayed action created on entering a workflow state with a timed transition (§5.9) |
| Connector | An extension whose implementation Kerangka ships, configured in JSON (§5.10) |
| Offline replay | Re-running a client's queued actions on the server with full validation (§8.3) |
| Invariant | An aggregate-level integrity assertion that must hold in all states and after every action (§5.13) |
| Wasm extension | A portable logic extension compiled to WebAssembly, running identically across all host engines (§5.10, ADR-0030) |
| Tenant overlay | Per-tenant model customizations (fields, decision tables, workflows) applied without modifying the base model (§5.14, ADR-0031) |
| Expand/contract | A two-phase migration and schema evolution strategy ensuring zero-downtime rolling upgrades across microservices (§7.6, §8.4, ADR-0032) |
| Human task | Work assigned to people on a workflow state, listed in the generated inbox (§5.11) |
| Effective date | The date that selects which version of a rule or decision table applies (§5.12) |
| Horizon | A roadmap stage: 1 is v1.0, 2 is v1.x, 3 is v2.0 (§19) |
| RFC | A public proposal for a spec change; accepted RFCs become ADRs (§18) |
| Projector | The compiler stage that turns `views` into UIDL documents |
| Effect | A description of I/O the host must perform (`persist`, `emit`, `call`) |
| Extension | A host-registered handler a document may call by name |
| Sidecar | `kerangka serve`: the engine as a local HTTP/JSON or JSON-RPC service |
| Conformance case | A JSON file with input and expected output, run against every engine |
| Tier | The level of support a language has (§11) |
| K1 | Kerangka's first expression extension set, proposed upstream to UIDL |
