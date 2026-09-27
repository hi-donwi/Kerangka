# Kerangka Semantics: Modules and Bounded Contexts

- **Specification Version:** 0.1
- **Status:** Draft

## 1. Modularity Principles

Kerangka organizes applications into **Bounded Contexts** following Domain-Driven Design (DDD) strategic design principles:

1. **Explicit Boundaries:** Each context owns its private entities, internal rules, and ubiquitous language.
2. **Contract-First Exports:** Contexts interact strictly through explicitly declared `exports` (actions, queries, events).
3. **ID-Only References:** Entities in Context A cannot hold direct object references or foreign-key joins to Context B. Cross-context references are strictly foreign identifier strings (`customerId: uuid`).
4. **Acyclic Structural Dependencies:** The dependency graph between contexts must form a Directed Acyclic Graph (DAG). Circular dependencies fail compilation with `CIRCULAR_DEPENDENCY`.

## 2. Context Directory Structure

```
contexts/<name>/
├── context.kerangka.json       Context manifest (name, exports, dependsOn, glossary)
├── aggregates/                 One file per aggregate root
├── views/                      UIDL view declarations
├── policies/                   Event reactions
└── tests/                      Executable scenarios
```

## 3. Compile-Time Flattening

All high-level abstraction constructs are flattened during compilation into the flat IR (`*.kir.json`):

- **Traits:** Reusable bundles of fields, rules, defaults, and permissions (`std:auditable`, `std:tenantScoped`) are injected into target entities.
- **Defs:** Named pure expressions are inlined at their call sites.
- **Templates:** Parameterised UI or action templates have their parameter values substituted.
- **Packages:** Reusable packages installed from npm or Git repositories are resolved, validated, and flattened into the consuming workspace IR.
