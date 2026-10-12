# Starters

`kerangka init <starter>` writes one of these folders into a new project, and
`kerangka init --list` prints them. A starter is data, not code (ADR-0043): adding one means
adding a folder here, and nothing in the CLI changes.

| Starter | Layout | What it gives you |
|---|---|---|
| `todo` | document | One entity and one guarded action: the smallest model that runs |
| `invoicing` | document | Embedded lines, computed totals, a draft-issued-paid lifecycle |
| `api` | document | A REST API: audited, soft-deleted records, role permissions, a named query |
| `dashboard` | document | KPI tiles over a deal pipeline and a list built from `std:masterDetail` |
| `admin-console` | document | Requests on the `std:approval` workflow, a dashboard, list and form screens |
| `workspace` | workspace | One bounded context laid out for `kerangka add` |
| `commerce` | workspace | Orders, billing, and inventory as contexts that talk through events |

## Format

```
starters/<name>/
├── starter.json      what the starter is and which files it writes
└── ...               the files themselves, as JSON
```

`starter.json`:

| Key | Meaning |
|---|---|
| `starter` | The name, identical to the folder name |
| `description` | One line for `kerangka init --list` |
| `layout` | `document`: one model named `${app}.kerangka.<ext>`. `workspace`: a folder with `kerangka.<ext>` |
| `tags` | Optional keywords |
| `files` | `{ "from", "to" }` pairs: `from` inside this folder, `to` inside the new project |
| `directories` | Optional empty folders to create, such as `contexts/core/views` |
| `next` | Optional commands to suggest afterwards; `${target}` is the model file or folder |

Substitution is deliberately small:

- `${app}` is replaced by the app name in every string value and in `to`.
- `${ext}` is replaced by `json` or `yaml` (from `--format`) in `to` only. A target ending
  in `.json` is always written as JSON, so `deploy.kerangka.json` stays JSON.
- Nothing else is touched: `${input.x}` and `${secret:NAME}` belong to connectors.

## The gate

`packages/cli/test/starters.test.ts` writes every starter and holds it to the same gate as
`examples/`: `check`, `verify`, `test`, every contract emitter, and a clean self-diff. It
also writes each starter as YAML and checks it. Every starter carries at least one
declarative example, so `kerangka test` proves the model does what its description says.
