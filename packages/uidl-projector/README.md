# @kerangka/uidl-projector

Compiles a Kerangka model's dashboard, list, and form views into UIDL screens **per request**,
through `uidl-runtime`'s page recipes (ADR-0045). It imports only `uidl-runtime/recipes`, which
has no React in its module graph.

```ts
import { compile } from "@kerangka/compiler";
import { RecipeProjector } from "@kerangka/uidl-projector";

const projector = new RecipeProjector(compile(model));

projector.views();                    // [{ id: "home", kind: "dashboard", ... }, ...]
projector.kpis("home");               // the KPIs the host computes for the caller
projector.dashboard("home", [         // one result per KPI, in order
  { value: 300.3 },
  { withheld: true },                 // the caller may not read its entity: left out
  { error: "..." },                   // could not be evaluated: shown without a number
]);
projector.list("invoices");           // the list screen
projector.form("invoice");            // an empty create form
projector.form("invoice", {           // the edit form of one record
  id: "INV-1",
  data: record,
  version: 3,                         // sent back with the save, so concurrent edits conflict
});
```

`kerangka serve` and `kerangka dev` serve these at `GET /screens`, `GET /screens/{viewId}`, and
`GET /screens/{viewId}/{id}`, after checking that the caller may read the entity (or create it,
for a create form) and, for a record, that its read permission and read filter admit it. For a
dashboard, the server computes each KPI with the engine (`Engine.kpiValue`) over the records the
caller may read, so two callers see their own figures.

What it maps:

| Model | Screen |
|---|---|
| A dashboard view | KPI row with the caller's figures; a count prints as an integer |
| A list view, or an entity with none | List screen; rows open the form view |
| A form view, or an entity with none | Create form; edit form for a given record |
| Workflow transitions | Buttons that show only in the states they leave from |
| Actions without input | Header buttons |
| `navigation` | A shell (sidebar and top bar) around every screen |

The projector does no I/O and evaluates nothing: the host computes the KPIs and passes them in.
