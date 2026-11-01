# Context Atlas Studio examples

These examples use synthetic names and structures. They contain no client snapshots,
credentials, or customer records.

## Launch an example

From the repository root, build Studio once:

```sh
npm run build
```

Then launch one project directory at a time:

```sh
node packages/cli/dist/bin/kerangka.js studio examples/context-atlas-api-only --port 8080
node packages/cli/dist/bin/kerangka.js studio examples/context-atlas-web-only --port 8080
node packages/cli/dist/bin/kerangka.js studio examples/context-atlas-full-stack --port 8080
```

Open the private local launch link printed by the command, select **Context**, then choose
the view for that project. Stop the host before launching another example.

## What each example shows

| Example | Context views | What to inspect |
|---|---|---|
| `context-atlas-api-only/` | Overview, Architecture, API, Data model | Generated HTTP methods and paths, query/path parameters, request fields, response shapes, model actions, and entity relationships. |
| `context-atlas-web-only/` | Overview, Architecture | The authored `/guide` UIDL page and its nested component types, stable element ids, and relative source reference. |
| `context-atlas-full-stack/` | Overview, Architecture, Request review, API, Data model | Generated list/form UIDL, a declared page-to-workflow journey, REST endpoints, entity fields, and action-to-endpoint relationships. |

Studio builds the Context map from its current inspection result. The API view summarizes
Kerangka's generated OpenAPI document; arbitrary external OpenAPI imports and arbitrary
source-code scanning are not enabled by these examples.

## Privacy boundary

The public files here are reproducible examples only. A Context snapshot is assembled in
the local Studio process from inspected metadata. It omits source text, UIDL prop values,
state and data-source values, OpenAPI descriptions and examples, preview records, and raw
generated OpenAPI or SQL. Keep real project snapshots in the project's approved private
context storage.
