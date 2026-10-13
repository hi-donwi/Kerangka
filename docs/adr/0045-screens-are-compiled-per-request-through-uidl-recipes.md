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
  else `kerangka uidl` writes, until the dashboard recipe can bind a KPI to a query. (Superseded
  by the amendment below: dashboards are served at `/screens` with values the server computes.)

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

## Amendment (2026-10-13): dashboards, with the caller's figures

`uidl-runtime@0.1.7` lets a dashboard KPI bind its value to data. Binding a Kerangka KPI to a
`$query` turned out to be the wrong mapping, for three reasons found while mapping it:

- The bridge reads one page of rows (50 by default). A `sum` or `avg` over the page is not the
  aggregate over the collection, and the generator's binding (`rows[0].<field>`) was not even
  that: it showed the first row's value.
- A KPI's `where` is K1 (`status == 'sent' && dueDate < today()`). A `$query` filter holds one
  comparison per row against a literal, so the generator dropped any `where` it could not lower,
  and "Overdue" counted every invoice.
- A KPI is a number about records, and who may see it depends on who may read them. A static
  document shows every caller the same figures.

**A dashboard is compiled with figures the server computes for the caller.**

- `Engine.kpiSource` names a KPI's aggregate, entity, and numeric field; `Engine.kpiValue`
  decodes each record, keeps those its `where` admits, and aggregates them with K1's own `count`,
  `sum`, and `avg`, so a KPI means what the same expression means anywhere else in the model.
  A KPI the engine cannot evaluate is `KPI_INVALID`, never a partial number.
- `KerangkaServer` passes only the records the caller may read (the read permission, per record,
  and the read filter). A KPI over an entity the caller may not read is left out, not shown as
  zero; one that cannot be evaluated shows no number, and its reason stays on the server.
- `RecipeProjector.dashboard(viewId, results)` maps the figures onto `compileDashboardPage`, with
  `integer` for a count and `number` otherwise. It does no I/O; the host computes.

Consequences:

- `/screens` serves dashboards with the caller's figures. The static generator does not.
- The figures are as of the request. A dashboard that should update while open re-requests its
  screen; binding to live data sources stays available to hosts that can aggregate server-side.
- Computing a KPI reads every record of its entity the caller may read, in memory, as a read
  filter's list already does. A store-level aggregate is the optimisation when that is too slow.
- `uidl-runtime@0.1.7` declared `react` and `react-dom` as optional peers but still listed them,
  and `@dnd-kit/*` that requires React, as dependencies, so npm still installed React.
  `uidl-runtime@0.1.8` lists only `zod`, and the projector requires it: the Negative consequence
  above about React is resolved.

## Amendment (2026-10-13): the static generator refuses a dashboard

The generator's dashboards were still served at `/uidl` and written by `kerangka uidl`. A `sum`
bound `rows[0].<field>`, so the tile showed the first row, and `lowerWhere` returned nothing for
any `&&`, so "Overdue" counted every invoice. That document was what a caller opening the
playground actually saw.

**A dashboard view is not a static UIDL document.**

- `UIDLGenerator.generate` skips a view whose definition is a dashboard. `refusedDashboards`
  names each one, with `DASHBOARD_NOT_STATIC` and `GET /screens/{viewId}`.
- `kerangka uidl` prints that refusal on stderr and does not write the file.
- `GET /uidl/{dashboardId}` on `KerangkaServer` answers **307** to `/screens/{dashboardId}`, so
  an existing link does not keep returning the wrong document. The playground lists screens,
  including dashboards, separately from static `/uidl` documents.
- The Hono adapter does not serve `/screens`. It answers **404** `DASHBOARD_NOT_STATIC` rather
  than redirecting to a route it does not have.

A static document that showed no number would still be a dashboard a host could mistake for the
figures. Refusing the document, and sending the caller to the screen that computes them, is the
closed failure.
