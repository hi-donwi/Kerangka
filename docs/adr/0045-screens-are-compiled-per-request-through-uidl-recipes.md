# ADR-0045: Screens Are Compiled per Request Through UIDL Recipes

- **Date:** 2026-10-13
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

ADR-0043 put presentation presets in UIDL-Runtime and left one follow-up: Kerangka's projector
should build its screens through UIDL's page recipes instead of its own builders, so a layout is
written once. `uidl-runtime@0.1.6` publishes the recipes as `uidl-runtime/recipes`, with no React
in its graph.

Mapping onto them showed that the recipes and `kerangka uidl` assume different hosts:

- The form recipe is compiled **per record**. It takes the record's data and its version, and it
  produces either a create document or an edit document. `kerangka uidl` writes a **static** set
  of screens once, with one form per view that serves `/view/:id`, and the host seeds the record
  into it at run time.
- Recipe forms bind fields at the state root (`state.<field>`, `state.id`,
  `state._meta.version`). The static forms bind `state.form.*` and load the record through a
  `record` data source.
- The dashboard recipe takes literal KPI values. A Kerangka KPI is an aggregate query.

## Decision

**Screens are compiled when they are asked for, by the server, through the recipes.**

- `@kerangka/uidl-projector` maps a compiled model onto the recipes:
  - Each list view, and each scaffold list, becomes a list screen.
  - Each form view becomes a create form, or an edit form for a given record (with its data and
    version).
  - Workflow transitions become state-gated buttons, and actions without input become buttons.
    All of them `mutate` through the `@kerangka/uidl` bridge.
  - The model's `navigation` becomes a `wrapInShell` around every screen.
  - The package depends on `uidl-runtime` and imports only `uidl-runtime/recipes`.
    `@kerangka/uidl` keeps its structural, dependency-free seam.
- `KerangkaServer` (what `kerangka serve` and `kerangka dev` run) serves `GET /screens`,
  `GET /screens/{viewId}`, and `GET /screens/{viewId}/{id}`. These routes are declared in
  `OPERATIONAL_ROUTES`, so they are in the served OpenAPI document. Authorization:
  - A list screen requires the read permission.
  - A create form requires the create permission. A conditional create grant is decided when
    the form is submitted, against what it sends.
  - A record screen embeds the record only when the actor may read it: its read permission and
    its read filter both apply (ADR-0040, ADR-0044).
- **Dashboards stay with the compiler's UIDL generator** under `/uidl`, together with everything
  else `kerangka uidl` writes, until the dashboard recipe can bind a KPI to a query.

## Consequences

### Positive

- A list or form layout is written once, in UIDL-Runtime, and improves for every host that uses
  it. Kerangka screens gain sortable lists, workflow buttons that hide in the wrong state, and the
  shell.
- An edit form carries the record's version, so a save goes out with it and the server rejects a
  concurrent change instead of overwriting it.

### Negative

- Two projections coexist for now: `/uidl` (static, generator) and `/screens` (per request,
  recipes). They converge when the dashboard recipe takes query-bound KPIs and the static output
  can be retired or rebuilt on the recipes.
- `uidl-runtime` declares `react` and `react-dom` as peers, so npm installs them into a project
  that only uses the recipes. Marking them optional is a change for the next UIDL-Runtime release.

### Neutral

- An action that takes input has no screen yet; it needs a form of its own.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Keep `kerangka uidl` static and map onto the recipes there | Every mismatch above becomes glue in the bridge, and a static edit form cannot carry the record's version |
| Import `uidl-runtime` into `@kerangka/compiler` | The compiler stays free of dependencies (ADR-0038's reasoning), and React would come with it |
| Use the recipes only for the shell and auth around the generator's screens | Leaves two implementations of a list and a form, which is what ADR-0043 set out to remove |
