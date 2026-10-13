# @kerangka/uidl-projector

Compiles a Kerangka model's list and form views into UIDL screens **per request**, through
`uidl-runtime`'s page recipes (ADR-0045). It imports only `uidl-runtime/recipes`, which has no
React in its graph.

```ts
import { compile } from "@kerangka/compiler";
import { RecipeProjector } from "@kerangka/uidl-projector";

const projector = new RecipeProjector(compile(model));

projector.views();                    // [{ id: "invoices", kind: "list", ... }, ...]
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
for a create form) and, for a record, that its read permission and read filter admit it.

What it maps:

| Model | Screen |
|---|---|
| A list view, or an entity with none | List screen; rows open the form view |
| A form view, or an entity with none | Create form; edit form for a given record |
| Workflow transitions | Buttons that show only in the states they leave from |
| Actions without input | Header buttons |
| `navigation` | A shell (sidebar and top bar) around every screen |

Dashboards are not projected here. Their KPIs are query aggregates, and the dashboard recipe takes
literal values, so dashboards stay with the compiler's generator under `/uidl`.
