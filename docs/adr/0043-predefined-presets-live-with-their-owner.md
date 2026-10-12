# ADR-0043: Predefined Presets Live With Their Owner, and a Template Is Used With `use`

- **Date:** 2026-10-12
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

Most applications repeat the same work: authentication, a marketing website, a dashboard, a
REST API, an admin console. Kerangka is meant to make that work small, and it already has the
mechanisms for reuse on paper (PLAN.md §7.5: types, traits, defs, templates, packages). Three
things stood in the way of using them.

1. **Templates were declared and never expanded.** `@kerangka/std` shipped `approval` and
   `masterDetail`; the package resolver registered them and `kerangka.lock` listed them, but
   the compiler only merged package `traits` and `types`. No document could use a template,
   and PLAN.md never said how one would. Both shipped templates were also in a shape the rest
   of the language does not read: `approval` listed its transitions as an array with an
   `action` key, where a model keys them by name, and `masterDetail` used `layout`, `master`
   and `detail`, none of which the UIDL projector reads.
2. **Starters were code.** `kerangka init` and `kerangka scaffold` hold their models inside
   TypeScript, so adding a starter means changing the CLI.
3. **Presentation presets had three possible homes.** UIDL-Runtime has seven page recipes
   (`list`, `form`, `report`, `dashboard`, `settings`, `tree`, `wizard`) that are pure
   functions; Kerangka's UIDL projector builds its own list, form, and dashboard documents
   beside them; and UIDL-Builder carries its own copies of industry templates that already
   differ from UIDL-Runtime's.

The question was where predefined modules, templates, and layouts for that repeated work
belong: here, in UIDL-Runtime, in UIDL-Builder, or in a repository of their own.

## Decision

**A preset lives with the owner of what it decides.** This follows the line PLAN.md §4
already draws, "Kerangka never renders; UIDL never decides a business outcome":

| Preset | Owner | Form |
|---|---|---|
| Logic: entities, traits, workflow, action and view templates, permissions, rules | Kerangka packages: `@kerangka/std`, and feature packs such as `identity` and `admin` | a package manifest the compiler resolves and expands |
| Presentation: page recipes, layouts, sections, themes | UIDL-Runtime, as public exports that do not need React | recipes and `definitions`, held to UIDL's conformance suite on every runtime |
| Starters that combine both: website, dashboard, API, admin console, authentication | Kerangka CLI | data under `starters/`, read by `kerangka init` |
| A visual gallery of all of the above | UIDL-Builder | a consumer of the catalogs; it owns no copies |

Authentication is the case that shows the split. Who a user is, which roles and tenant they
have, and what each role may do are model facts and belong in a Kerangka pack. Checking a
password or a token stays in the host adapter that produces the `actor` (PLAN.md §4), and the
login and sign-up screens are UIDL recipes.

There is no separate presets repository for now. A preset that is not compiled by the same CI
as the compiler stops matching the compiler; lockstep versioning (ADR-0006) already ties a
package to the compiler that reads it. A pack moves out once a hub or outside maintainers give
it a reason to, and because each pack is a manifest of its own, the move is a copy, not a
rewrite.

**A template is used with `use` and `with`.** At an entity's `workflow`, at an entry of an
entity's `actions`, or at an entry of `views`:

```json
"workflow": { "use": "std:approval", "with": { "submitter": "employee", "approver": "manager" } }
```

- The compiler replaces each instance with its expansion after resolving packages and before
  anything reads the model, so the IR never holds a template (ADR-0011).
- A string that is exactly `"${p}"` becomes the argument's JSON value; `${p}` inside a longer
  string is interpolated and must be a string, number, or boolean. `${a.b}` and `${a:b}` are
  left alone, because connectors interpolate those at run time. A placeholder in an object key
  is refused, since it would otherwise survive unexpanded.
- A template declares `params` as a list of required names, or as a map of names to
  `{ "default", "description" }`. An argument it does not declare, a required one that is
  missing, and a placeholder the template uses without declaring are all errors.
- A template has a `type` (`workflow`, `action`, or `view`) and is refused at any other
  position. Templates do not nest.
- Keys written beside `use` merge into the expansion one level deep: a new transition can be
  added, but a key or entry the template already defines is `TEMPLATE_KEY_CONFLICT`. A
  template is never overridden silently, which is the rule traits already follow.
- The expansion is checked by the same structural layer as hand-written input (ADR-0038).
  Its diagnostics point into the instance and name the template they came from.
- `kerangka expand` prints the expanded entities and views.

The two shipped templates now have the shapes the language reads: `std:approval` keys its
transitions `submit`, `approve`, and `reject`, and `std:masterDetail` is a `list` view with
`columns`.

## Consequences

### Positive

- A model can use a template at all, so a package can carry an organisation's approval flow
  or list layout and every project that uses it gets the same thing.
- One implementation of substitution: `expandTemplate` in `@kerangka/std` serves both the
  compiler and `instantiateTemplate`, so they cannot disagree about what a template means.
- Each repository has one answer to "where does this preset go", and UIDL-Builder stops being
  a place where templates drift.

### Negative

- `std:approval` and `std:masterDetail` changed shape. Neither could be used before this
  change, so no model breaks, but code that read `STD_PACKAGE.templates` directly sees the
  new shape, and `instantiateTemplate` now returns only the expansion.
- `kerangka expand` prints `{ "entities", "views" }` instead of the bare entities map.

### Neutral

- Projecting views through UIDL-Runtime's recipes instead of the projector's own builders is
  a separate change and gets its own ADR. This one decides where presets live, not how the
  projector is built.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Keep templates in UIDL-Builder | It is an application, not a library: nothing in `kerangka init`, in hand-written UIDL, or in the conformance suite can reach them, and its copies already differ from UIDL-Runtime's |
| Put every preset in UIDL-Runtime | Approval, audit, and permissions are business decisions, and UIDL deliberately makes none |
| Put every preset in Kerangka | Login screens, sidebars, and hero sections are needed by UIDL users who never use Kerangka |
| A separate presets repository now | Presets kept outside the compiler's CI stop matching it; nothing needs that boundary yet |
| A string shorthand, `"workflow": "std:approval"` | Templates take parameters, and two spellings for one thing is what the structural layer exists to prevent |
| Overrides for local keys beside `use` | A silent override is how a trait's field used to vanish; additions cover the need without it |

## Follow-up

- [x] Template expansion in the compiler, with `meta-schema` support for instances
- [x] `std:approval` and `std:masterDetail` in the document shape
- [x] Starters under `packages/cli/starters/`, read by `kerangka init` and `kerangka scaffold`
- [x] UIDL-Runtime: recipes exported without React (`uidl-runtime/recipes`); `compileAuthPage`,
  `wrapInShell`, and `compileLandingPage` (UIDL-Runtime ADR-0010), not yet released to npm
- [x] `saas-auth` starter: the identity model, with credentials left to the host
- [ ] Packs `identity` and `admin`; the UIDL projector maps views onto UIDL recipes (own ADR)
- [ ] UIDL-Builder reads its gallery from the catalogs
