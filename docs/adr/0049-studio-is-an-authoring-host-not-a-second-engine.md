# ADR-0049: Studio Is an Authoring Host, Not a Second Engine

- **Date:** 2026-10-16
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

Studio needs to design models, workflows, pages, routes, permissions, APIs, and database
changes together. Kerangka already owns business semantics and its single compiler
(ADR-0002); UIDL owns presentation (ADR-0001). ADR-0043 places reusable presets with
their semantic owner and makes UIDL-Builder a catalog consumer.

There are already two relevant editor surfaces. Static source inspection found:

| Surface | Evidence | Reuse decision |
|---|---|---|
| UIDL-Builder | `src/core/builderStore.ts`, `draftPersistence.ts`, and `broadcastSync.ts` couple the app store to browser persistence, pages, and cross-tab synchronization | Do not import or copy its global application store into Studio |
| Builder canvas | `src/components/CanvasViewport.tsx` renders UIDL with mock mutation results and page-switch interception | Reuse interaction requirements, not mock execution as a business simulator or security boundary |
| Builder source panel | `src/components/CodeMirrorEditor.tsx` is a textarea backed by JSON parsing and the app store | Do not introduce a code-editor dependency based on the filename |
| Builder catalog | `src/core/templateCatalog.ts` at `e2a95da` consumes `uidl-runtime/catalog/gallery.json` | Consume the owner-maintained catalog; do not restore old template copies |
| Builder extensions | `src/core/widgetExtensionSandbox.ts` registers widget metadata | A registry is not an execution sandbox; no automatic plugin loading |
| UIDL editor | `packages/core/src/editor/Editor.tsx` at `619e094` exposes initialDocument and preview handlers, but no controlled document/change callback | Extend the shared public editor seam before persistent visual editing; do not deep-import its internal store |
| UIDL canvas | `packages/core/src/editor/Canvas.tsx` renders through UIDocumentRenderer in the host realm | Reuse the renderer; add a separately enforced preview boundary in the host |

These are source/interface findings, not browser acceptance, package compatibility, or
performance results. Builder's catalog change and its older checked-out implementation
must not be confused when estimating reuse.

## Decision

We design **Kerangka Studio** as a local-first authoring host. Its canonical development
entry is a configurable `/studio`, illustrated by `http://localhost:8080/studio`.
We use multiple editors over the same versioned sources, not a universal executable graph.
CP0 accepted these technical decisions on 2026-10-16; this ADR does not implement the entry point.

| Responsibility | Owner / future location | Boundary |
|---|---|---|
| Authoring application | Kerangka `apps/studio/` | React shell, source explorer, inspectors, diagnostics, review |
| Local project service | Kerangka `packages/studio-server/` | Confined source loading, draft revisions, validation jobs, preview lifecycle |
| Business semantics | Existing compiler, engine, ports, projectors | No dependency on Studio or a graph library |
| Generic page editor | UIDL-Runtime public editor contract | Shared by Studio and standalone UIDL-Builder; no duplicated template/editor implementation |
| Catalogs/recipes | Existing Kerangka packs and UIDL public exports | Follow ADR-0043; consumers own no copies |
| Identity, application routes, data, effects | Explicit host adapters | Document intent never supplies trusted authority |

The app/service paths are reserved design locations, not packages to create in P0.
P1 must deliberately add the app workspace/build wiring; normal runtime imports must
not pull in development assets. UIDL-Builder remains a standalone presentation authoring
consumer; no repository move, forced migration, or private-source dependency is required.
The shared editor must eventually accept controlled document changes, external revisions,
registry/capability input, and disabled effect handlers. Its exact public API belongs to
the UIDL owner and is reviewed before persistent page editing, rather than guessed here.

Use JSON source editing and tables/trees first. Select **React Flow** as the graph-surface
candidate for the workflow state editor, not as a runtime or an engine. The evaluated npm version was
`@xyflow/react@12.12.0` (MIT; React peers >=17). No graph dependency is installed in P0.
Before adoption, pin the reviewed version and prove controlled-state/source mappings,
keyboard alternatives, legal workflow cycles, actual bundle cost, and the scale budget.
If the spike fails, retain the table editor and revisit the choice; do not silently add
layout, collaboration, or paid-example dependencies. Unpacked npm size is not bundle size.

The first acceptance model is a synthetic employee/manager request approval application.
See [Studio scope and CP0](../studio/README.md). The complete UI journey is a later gate;
pure-engine fixture tests are only its semantic starting point.

## Consequences

### Positive

- CLI, source editing, visual editing, and future AI proposals share one semantic path.
- Existing UIDL capabilities are reused without treating a standalone browser app as a library.
- A small local explorer can ship before generic page editing or broad workflow execution.

### Negative

- A controlled shared-editor seam and host preview boundary still require implementation.
- Source-preserving edits, reference resolution, and revision conflict handling are new work.
- Cross-repository public contracts need coordination and explicit compatibility checks.

### Neutral

- JSON/YAML/KIR/business syntax is unchanged by the Studio authoring envelope.
- No backward-compatibility adapter is introduced for an unshipped Studio format.
- Hono KX-01 remains Hono-only; host authentication and store conformance are separate gates.

## Alternatives Considered

| Alternative | Reason not selected |
|---|---|
| Copy UIDL-Builder into Kerangka | Duplicates the browser store, presets, persistence, and preview semantics |
| Embed the complete Builder app as the source authority | No host-controlled revision contract; mocks cannot prove business behavior |
| Build a new page renderer or workflow engine | Contradicts ADR-0001/0002 and loses conformance |
| Put all authoring fields inside `.kerangka.json` | Mixes host/editor state with business semantics and unsupported model keys |
| One executable graph for every concern | UI containment, state transitions, ordered statements, and database references are different structures |
| Build multiplayer, edge, AI, or eject first | Does not prove the smallest correct manual editing path |

## Follow-up

- CP0 accepted this ADR, the source contract, and security budgets before P1.
- Implement confined read-only loading and isolated synthetic preview before source writes.
- Require a real authenticated Hono/store integration proof before writable/shared preview.
- Verify the shared UIDL editor API and graph candidate at their implementation gates.

## References

- [UIDL-Builder source](https://github.com/hi-donwi/UIDL-Builder/tree/e2a95da/src)
- [UIDL editor source](https://github.com/hi-donwi/UIDL-Runtime/tree/619e094/packages/core/src/editor)
- [React Flow documentation](https://reactflow.dev/learn)
- [Source-bundle contract](../studio/source-bundle.md)
- [Security boundaries and budgets](../studio/security.md)
