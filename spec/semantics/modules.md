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
- **Templates:** Parameterised workflow, action, and view templates are expanded where an instance names them (`{ "use": "std:approval", "with": { ... } }`), with their parameter values substituted. See §4.
- **Packages:** Reusable packages installed from npm or Git repositories are resolved, validated, and flattened into the consuming workspace IR.

## 4. Template Instances

A template instance stands where a declaration of the template's `type` goes:

| Template `type` | Position |
|---|---|
| `workflow` | `entities.<Entity>.workflow` |
| `action` | `entities.<Entity>.actions.<name>` |
| `view` | `views.<name>` |
| `entity` | `entities.<Entity>` (the document chooses the name) |

1. **Resolution.** `use` names a template exported by a package the document uses
   (`std:approval`, `@kerangka/std:approval`). An unknown name is `TEMPLATE_UNKNOWN`; a template
   at a position of another type is `TEMPLATE_KIND_MISMATCH`.
2. **Arguments.** `with` maps parameter names to JSON values. An argument the template does not
   declare is `TEMPLATE_PARAM_UNKNOWN`; a declared parameter with no argument and no `default` is
   `TEMPLATE_PARAM_MISSING`.
3. **Substitution.** A string that is exactly `${p}` is replaced by the argument's JSON value.
   `${p}` inside a longer string is replaced by the argument's text, and the argument must then be
   a string, number, or boolean (`TEMPLATE_PARAM_NOT_SCALAR`). Placeholders containing `.` or `:`
   are not template parameters and are left unchanged. Object keys are never substituted; a
   placeholder in one is `TEMPLATE_PARAM_IN_KEY`. A placeholder the template does not declare is
   `TEMPLATE_PARAM_UNDECLARED`.
4. **Order.** An entity instance expands first; workflow and action instances in its result,
   including ones written beside its `use`, expand after it. An entity template whose own body
   contains an instance is `TEMPLATE_INVALID`.
5. **Metadata.** `template`, `type`, `description`, and `params` describe the template and are not
   part of its expansion. A template whose body contains `use` is `TEMPLATE_INVALID`: templates do
   not nest.
6. **Local keys.** Any key beside `use` and `with` must be a key of the position. It is merged into
   the expansion: a key the expansion lacks is added; when both are objects their entries are
   merged; an entry or key present in both is `TEMPLATE_KEY_CONFLICT`.
7. **Checking.** The expansion is validated by the structural layer exactly as hand-written input
   is, and its diagnostics carry the pointer of the position inside the instance.
