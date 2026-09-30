# Kerangka Semantics: Statement Cells and the `then` / `do` Vocabulary

- **Specification Version:** 0.1
- **Status:** Draft
- **Normative:** yes

## 1. Overview

A cell is any value written where a model expects a value that may be computed rather than
written: `then[].set` values, `do[].set` values, `then[].emit.data` values, policy `with`
values, and decision-table output cells.

Kerangka defines **one** resolution rule for cells so that the same text means the same thing
everywhere. Without it, `"sent"` would be a literal in one place and an identifier in
another, and every implementation would have to guess.

## 2. The resolution rule

A cell is resolved in this order, and the first rule that applies wins:

| # | Cell shape | Resolution |
|---|---|---|
| 1 | `null`, or the string `"-"` | *Don't care* (input cells only). Output cells resolve to `null`. |
| 2 | Number, boolean | Literal value |
| 3 | String wrapped in quotes (`'sent'`, `"sent"`) | Literal string, quotes stripped |
| 4 | Object with `operator` (and `args`, `value`, or `path`) | Compiled as a K1 call node and evaluated |
| 5 | Object with `literal` | The literal it wraps |
| 6 | String that parses to a K1 **bind** or **expression** node | Compiled and evaluated |
| 7 | Anything else | Literal, exactly as written |

Rule 6 is the only ambiguous one, and it is closed by three guards:

- **Parse failure is a literal.** `INV-o-1` and `sent` are values, not expressions.
- **Only binds and expressions evaluate.** A string that parses to a literal node is a
  literal.
- **A `null` result falls back to the written text.** An expression that cannot resolve
  (`total * input.percent` with no input) never silently erases a field; the cell stays as
  written, and the surrounding statement's own validation still applies.

> **Cell rule:** a cell is computed only when it unambiguously compiles to K1 and evaluates to
> a non-null value. Otherwise it is a literal.

## 3. Evaluation scope per cell site

The scope differs by site because the data differs, not because the rule does:

| Site | Scope |
|---|---|
| `then[].set`, `do[].set` | `record`, `data` (the working record), `input`, `actor`, `now` |
| `then[].emit.data` | `record`, `data`, `now` |
| Decision-table output cell | the row's input columns, plus `cell` (the value in the same column) and `value` |
| Policy `with` value | `event`, `eventMetadata`, `record`, `state`, `data`, `user`, `actor`, `input` |

Policy values apply one extra restriction: a bare path (`issued`) is a literal even though it
parses as a bind, because a policy author writing `issued` means the word. Only a path rooted
in a scope name (`event.data.orderId`) or a call (`concat(...)`) is computed.

## 4. Statement vocabulary

The statement list in `then` (workflow transitions) and `do` (actions) is fixed and small.
`do` and `then` are the same list; an action may use either.

| Statement | Meaning |
|---|---|
| `{"set": {"<field>": <cell>}}` | Assign fields on the target record |
| `{"append": {"<list>": <cell>}}` | Add one element to an embedded list |
| `{"remove": {"<list>": <cell>}}` | Remove every element of an embedded list equal to the cell |
| `{"create": {"entity": "X", "values": {…}}}` | Create a new aggregate in the same context, as a `persist` effect |
| `{"transition": "<name>"}` | Run another declared transition of the same entity |
| `{"emit": "<Event>", "data": {…}}` | Raise a declared domain event |
| `{"call": "<extension>", "with": {…}}` | Ask the host to run a registered handler |
| `{"fail": {"code": "…", "message": "…"}}` | Abort with an error |
| `{"if": <cell>, "then": [...], "else": [...]}` | Branch |
| `{"timer": "<duration>"}` / `{"after": "<duration>"}` | Schedule a follow-up action |

Statements run in declaration order, and a list may be nested inside `if` or `then`.

**Branching is fail-closed.** `true` takes `then`; `false`, `null`, and an absent value take
`else`. Any other value — a string, a number, an object — is indeterminate: the action is
refused with `IF_INDETERMINATE` rather than taking a branch the author did not write.

**A `fail` aborts the whole action**: no patch, no event, no effect. The same holds for a
`create` whose new aggregate does not validate, for a `transition` that is not declared, and
for a statement key outside this table (`STATEMENT_UNKNOWN`).

**A `create` is validated before it is emitted.** The values are resolved with the cell rule,
the new aggregate is computed, and it must validate; only then does a `persist` effect leave
the engine. Existing aggregates other than the target change only through events and
policies (§7.4).

**A `transition` statement** moves the same record through another transition of its own
entity, including that transition's own statements. It is not a recursive workflow: an entity
may not chain transitions into a cycle, and nesting deeper than eight levels is refused with
`STATEMENT_TOO_DEEP`.

## 5. Why the rule is fail-safe

- A wrong value is visible: the record fails validation and the action is refused, rather than
  committing a silent corruption.
- A typo (`"sent "` handled as literal, `ttoal` evaluated to `null` → literal) cannot produce a
  plausible-looking wrong number; it produces the text the author wrote.
- The same cell text in a Go, Dart, or JVM implementation resolves identically, so a decision
  table is portable.

## 6. Conformance

Cases live in `conformance/`. Each case that sets a field from a cell must assert both the
computed result and the literal fallback.

```json
{ "then": [{ "set": { "dueDate": "addDays(issuedOn, 30)" } }] }
{ "then": [{ "set": { "status": "sent" } }] }
{ "outputs": [{ "name": "rate", "value": { "operator": "multiply", "args": [{ "path": "base" }, "1.2"] } }] }
```
