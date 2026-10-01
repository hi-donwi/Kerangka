# ADR-0038: A Model Document Is Checked for Shape Before It Is Compiled

- **Date:** 2026-09-30
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

The compiler validated *names*. A field type that did not resolve, an entity that was not
declared, a function that did not exist — all reported, with a pointer and a suggestion. That
layer works, and it is the reason the language is pleasant to use.

What it did not do was check that the document was structurally a model at all. Because a
structurally wrong document is not rejected, it is *half-read*, and the three ways that
happened were all bad in different ways:

| Written | What happened |
|---|---|
| `{ "fieds": { ... } }` on an entity | Every field on that entity silently dropped. Compilation **succeeded**. |
| `{ "Thing": "Thing" }` under `entities` | The entity vanished from the compiled model. Compilation succeeded. |
| `{ "nickname": { "required": true } }` | Reached the semantic validator as `undefined` and threw `Cannot read properties of undefined (reading 'length')` — a raw `TypeError` in a user's face. |
| `"entities": "Thing"` | Not an object; silently ignored. |

The first two are the worst outcome available. A misspelled key is not an error the compiler
can see, because the compiler never looks for keys it does not know. What it produced was a
model that meant something other than what was written, compiled clean, and wrong.

## Decision

**Add an L0 layer: does this document have the shape of a Kerangka model at all.** It runs in
`compileDocument` before anything else touches the document, and a document that fails it is
never compiled — the same treatment a parse error already got, and for the same reason: a
document that is not a model cannot be compiled, and continuing produces cascading nonsense
from a single structural mistake.

**Two things are published, and they are not the same thing.**

1. `validateModelStructure` — the checks the compiler runs. Hand-written, dependency-free.
2. `modelSchema()` — a JSON Schema 2020-12 document, written to
   `packages/compiler/schemas/kerangka.model.schema.json`, for editors and for anything that
   already has a validator.

**There is no `ajv` and no network fetch, and there will not be one.** The compiler has to run
in a build that has installed nothing, on a machine that may be offline. A validator that
cannot run is a validator nobody runs.

## Consequences

### Positive

- A typo'd key is a diagnostic naming the key and suggesting the right one, instead of a
  silently different model.
- A field with no `type` is a diagnostic with a pointer, not a `TypeError`.
- Every structural error is collected, so an author fixes a list rather than one per run.
- Editors can validate a model as it is typed, and CI can validate it with a standard tool.
- The published schema is covered by a test asserting it equals what the compiler checks
  against, so the artefact cannot drift from the behaviour.

### Negative

- **The key lists are hand-maintained, and that is the real cost.** The vocabulary is closed —
  `toJsonSchemaField` reads one key at a time — so a key that is neither declared in
  `types.ts` nor read anywhere does nothing at all. The first draft of this file padded both
  lists with keys the compiler never reads (`indexed`, `label`, `format`, `minLength` and
  about twenty more), which meant it *accepted* them and dropped them: precisely the defect
  this layer exists to close, committed by the layer written to close it. The lists are now
  exactly what the language honours, and two tests derive them from `types.ts` and from the
  field mapper so they cannot rot silently.
- The published schema is permissive (`additionalProperties: true`) while the compiler is
  strict. That is deliberate and it is an asymmetry: a validator that *rejected* an unknown
  key would be wrong the moment the language gains one, and the language gains them faster
  than schemas get updated. The compiler reports; the schema does not block.
- The schema's field objects are permissive for the same reason — a UIDL-style recursive or
  evolving shape would need the schema updated whenever a field type gains a member.
- Unknown-key strictness is new behaviour. A model that carried a speculative key and
  compiled before now does not, which is the intended outcome and may still surprise someone.

### Neutral

- An unresolvable *type* (`"type": "NotAType"`) is well-formed and is still the semantic
  validator's business. Duplicating the resolver here would mean two places to keep in step.
- The field shorthand (`"creditLimit": "decimal(12,2) >= 0 = 0"`) is accepted as a form and
  left to `normalizeField` to interpret, which is the layer that can actually say which part
  of the shorthand it did not understand. The first draft of this file rejected it and made
  every entity in every shipped example an error.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Add `ajv` and validate against a schema | The compiler must run where nothing is installed and there may be no network. A validator that cannot run is one nobody runs. |
| Fix each failure where it happens, individually | Three crashes in three places, and the silent ones produce no crash to fix. The typo'd-key case needs a *list of known keys*, which is a schema whether or not it is called one. |
| Warn instead of error | A model compiled with its fields silently dropped is the failure this exists to prevent. A warning is the same outcome with an extra step for the author to ignore. |
| Make the emitted schema strict (`additionalProperties: false`) | Wrong the moment the language gains a key, and it blocks tools on a stale artefact. The compiler is the place for strictness because it is the place that can be updated with the language. |
| Validate in the CLI rather than in `compile` | Anyone calling the library — the sidecar, the server, a test — would get the old behaviour. The shape of a document is a property of the document, not of the front end that read it. |

## Follow-up

- [x] `validateModelStructure` in `packages/compiler/src/meta-schema.ts`
- [x] Run in `compileDocument` before the document is touched, collecting every error
- [x] `modelSchema()` published to `packages/compiler/schemas/kerangka.model.schema.json`
- [x] Exported from the package, with a `files` entry so the schema ships
- [x] Tests derive `ENTITY_KEYS` and `FIELD_KEYS` from `types.ts` and the field mapper, in both
      directions
- [x] A test that the published file equals `modelSchema()`
- [x] Entity-level structure beyond the key list: `workflow` states, `actions` and `rules`
      shapes are now checked. Each of the three was an increment, and each found something
      the layer above had been silently accepting.

## Amendment: the interfaces were not complete (2026-10-01)

Extending the key lists to `workflow`, `actions` and `rules` produced a false positive worse
than the typo the layer exists to catch, because deriving a key list from `types.ts` assumes
the interfaces are complete. They were not:

| Key | Read by | Declared on |
|---|---|---|
| `final` | `verifyWorkflows` (`workflow.terminal \|\| workflow.final`) | nothing |
| `after`, `timer` | the engine, for a timed transition (ADR-0015) | nothing |
| `emit` | the event verifier, the AsyncAPI projector, the engine | nothing |

All five are read off the **raw document**, so all five are legal input. A strict check built
from the interfaces alone would have reported every timed transition, every `emit` shorthand,
and every model using the `final` alias as having a typo. The interfaces now declare what the
engine honours, which is the fix, and a test asserts each read-but-undeclared key is declared
so the next one found fails there rather than in a user's model.

Three of these were found only by grepping the readers rather than trusting the type — which
is the concrete form of the "hand-maintained key lists" cost recorded above.

## Amendment: silently accepted forms (2026-10-01)

The same increment found three forms that were neither rejected nor honoured:

| Written | What happened |
|---|---|
| `actions: { send: "send" }` | Compiled to an **empty action**. `actionDef.when` on a string is `undefined`, not an error, so the action existed in the API and did nothing when called. |
| `rules: ["amount > 0"]` | Compiled to `rules: [{}]` — no id, no check, no message. A rule that can never fire. The string form *is* honoured on a trait, so it is easy to write by accident. |
| `actions: { send: { run: "name" } }` | Dropped whole, because the compiler guards `run` with `typeof run === "object"`. |

All three are diagnostics now. Still unchecked, and the obvious next candidates: `invariants`
(`inv.assert` is read the same unchecked way `rule.check` was) and `permissions`.
