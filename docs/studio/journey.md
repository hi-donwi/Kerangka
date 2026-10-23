# Studio Journey Contract 0.1

Status: Accepted with ADR-0050 on 2026-10-21. This is an authoring contract, not a Kerangka
model, not a UIDL document, not an execution format, and not an authority grant. The
checked-in [JSON Schema](../../spec/studio/journey.schema.json) is the structural contract;
the semantic gates live in `@kerangka/studio-server`.

## What a Journey Is

A journey is an **index over existing behavior**. It names steps and says where a
connection is realized. It owns no action, no guard, no role, no credential, and no effect.

| Element | Names | The behavior belongs to |
|---|---|---|
| `page` step | A page in the source bundle's application manifest | The authored UIDL source, or the recipe that generates it |
| `operation` step | An `Entity.action` or `Entity.transition` in the model | The Kerangka compiler and engine |
| `action` link | An event action in the source page's UIDL document | The UIDL document and the runtime interpreter |
| `navigation` link | A navigation between pages | The UIDL `navigate` action and the host route contract |
| `annotation` link | A note for the author | Nothing; it is not executed |

Because the behavior has one owner, the visual surface cannot disagree with the compiled
model or the rendered document. A journey that needs a connection no action provides must
have that action authored first, and the journey then points at it.

## Shape

```json
{
  "kind": "kerangka.studio.journey",
  "version": "0.1",
  "mode": "reference",
  "id": "request-approval",
  "name": "Synthetic request approval",
  "entry": "requests",
  "steps": [
    { "id": "requests", "kind": "page", "page": "requests" },
    { "id": "submit", "kind": "operation", "operation": "Request.submit" }
  ],
  "links": [
    {
      "id": "create",
      "from": "requests",
      "to": "submit",
      "kind": "action",
      "pointer": "/root/children/0/events/onClick/0"
    }
  ]
}
```

`mode` is `reference` only. An executable journey would need its own specification,
runtime, and conformance suite, and a superseding ADR.

## Pointers

A pointer addresses the live node tree of the source page's UIDL document:

```text
/root
/root/children/<index>
/root/slots/<name>/<index>
/root/children/<index>/events/<event>/<index>
```

It starts at the document root, walks only `children`, `slots`, and `events`, and ends at
an event action. It cannot address a reusable definition, because a definition is a
template instantiated in several places, and it cannot walk inside an action, because a
link points at something a person triggers.

Pointer segments accept the JSON Pointer escapes `~0` and `~1`. Prototype and traversal
segments are refused. A pointer longer than 512 characters is refused.

## Gates

| Stage | Checked | Reported as |
|---|---|---|
| Structural | Kind, version, mode, identifiers, step and link shape, pointer syntax, unknown fields | `STUDIO_JOURNEY_*` |
| Reference | Entry, page, operation, and link endpoints exist | `STUDIO_JOURNEY_ENTRY_UNKNOWN`, `STUDIO_JOURNEY_PAGE_UNKNOWN`, `STUDIO_JOURNEY_OPERATION_UNKNOWN`, `STUDIO_JOURNEY_LINK_FROM_UNKNOWN`, `STUDIO_JOURNEY_LINK_TO_UNKNOWN` |
| Document | The pointer resolves to an event action in an authored page document | `STUDIO_JOURNEY_LINK_POINTER_UNRESOLVED`, `STUDIO_JOURNEY_LINK_DOCUMENT`, `STUDIO_JOURNEY_LINK_SOURCE` |
| Ownership | One action leads to one target; one operation belongs to one journey | `STUDIO_JOURNEY_ACTION_CONFLICT`, `STUDIO_JOURNEY_OPERATION_CONFLICT` |

Structural acceptance is not semantic acceptance. A document can pass the schema and
still name a page that does not exist, and that is a separate report, not a silent pass.

The schema and the runtime validator are checked against one corpus, so the two cannot
drift apart.

## Authority

A journey grants nothing. It names no role, and a resolved link says which existing action
a person triggers, not that the person may. Authorization stays with the Kerangka
permission model and the host, and a route that a journey names is not thereby reachable
by anyone. A journey is also not a preview: an authored page still renders through the
real UIDL runtime under the preview profile, and a referenced operation still runs under
the engine's own rules.

## Not in Scope

- Executing a journey, or any orchestration semantics of its own.
- Storing journeys in the source bundle. The bundle owns page ownership and routes; a
  journey has different elements and its own versioned contract.
- Authoring UIDL actions from a journey. The action is authored in the document; the
  journey points at it.
