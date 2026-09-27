# Kerangka

**One JSON skeleton. Every stack.**

*Kerangka* is Indonesian for *framework* or *skeleton*. It turns one small JSON document
into application **logic** — validation, computed values, business rules, actions,
workflows, and permissions — and **frontend** screens, with identical behaviour in every
language.

```json
{
  "kerangka": "0.1",
  "app": "todo",
  "entities": {
    "Task": {
      "fields": {
        "title": "string!",
        "done": "bool = false",
        "due": "date"
      },
      "rules": [{ "id": "title-not-blank", "check": "len(trim(title)) > 0", "field": "title" }]
    }
  }
}
```

- **Logic** runs in a small, pure engine available natively in TypeScript, Java/Kotlin,
  Python, Dart, and Go — and in any other language through a sidecar.
- **Frontend** is emitted as [UIDL](https://github.com/hi-donwi/UIDL-Runtime) documents,
  rendered on React, Flutter, and Android.
- **Same answer everywhere**, proven by a language-neutral conformance suite.
- **Modular by design:** bounded contexts, aggregates, events, and reusable packages, with
  boundaries enforced by the compiler. The same model runs as a modular monolith or as
  microservices on different stacks.
- **Any storage, any API, same rules:** PostgreSQL, SQLite, MySQL, Redis/Valkey, REST,
  GraphQL, MCP, and more are adapters and projections of one model. Start with a single
  database; add the rest by configuration.
- **Complex logic without code:** decision tables, schedules and timers, connectors, and
  tools that explain and verify your logic.

**Ambition:** an open standard for building software — by hand or with AI assistants — from
a single-file tool to a very large, very complex system that scales without a rewrite.

## Status

Planning. Nothing is implemented or published yet. Read [PLAN.md](PLAN.md) for the design,
the roadmap, and the decisions still to be made.
