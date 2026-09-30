# Kerangka Python SDK

Specification Version: 0.1
Status: Scaffolding / Draft
License: Apache-2.0

## Overview

The Kerangka Python SDK provides async and sync bindings for running Kerangka applications with FastAPI, Django, or pure Python backends.

## Modules

- `kerangka.kir`: Loader and validators for compiled KIR JSON documents.
- `kerangka.ports`: Abstract protocol definitions for runtime ports (`StorePort`, `BusPort`, `CachePort`).
- `kerangka.engine`: Pure reference execution engine.
- `kerangka.sidecar`: Client for `kerangka serve --stdio`, for any Python process that does
  not embed a native engine.

## Driving a model from Python

The sidecar is the supported path today (PLAN.md §11, L1). The client speaks JSON-RPC over
the sidecar's stdin and stdout, and needs only the standard library:

```python
from kerangka.sidecar import Sidecar

with Sidecar("examples/invoicing.kerangka.json") as kerangka:
    print(kerangka.describe()["entities"])

    draft = {
        "number": "INV-1",
        "customer": "cust-1",
        "issuedOn": "2026-09-01",
        "dueDate": "2026-10-01",
        "status": "draft",
        "lines": [{"description": "Consulting", "qty": 2, "unitPrice": 150}],
    }
    actor = {"id": "u-1", "roles": ["billing"]}

    result = kerangka.run("Invoice.send", draft, actor=actor)
    assert result["ok"], result
    print(result["record"]["status"])          # sent
```

Start the sidecar yourself with `kerangka serve <document> --stdio`, or let the client start
it. A domain refusal comes back as a result with a stable code (`PERMISSION_DENIED`); a
protocol problem raises `SidecarError` with the JSON-RPC code.

### The sidecar session

The engine is pure: `run` returns effects, and a host applies them. The sidecar is such a
host, so a session remembers what it has seen:

```python
kerangka.run("Invoice.send", draft, actor=actor)      # returns the result
kerangka.get("Invoice", "inv-1")                      # the stored aggregate
kerangka.list("Invoice")                               # everything stored
kerangka.events("InvoiceSent")                        # emitted events, oldest first
```

`run` accepts a record with only an `id`: the sidecar loads what it stored, runs, and
stores the result, so a client need not ship the whole aggregate back and forth. A refused
run stores nothing.

| Method | Purpose |
|---|---|
| `get(entity, id)` | The stored aggregate, or `None` |
| `list(entity)` | Every stored aggregate of an entity |
| `put(entity, record)` | Seed a record, computed the way the engine computes it |
| `events(type=None)` | Events emitted this session |
| `clear()` | Forget the session |

These are sidecar methods, not Runtime API ones: a native engine stays pure, and a real
deployment brings its own database. The store is in memory, per sidecar process.

`scripts/sidecar-smoke.py` runs the whole invoicing workflow this way, asserts that a
persisted record reads back, and is part of CI.

## Quickstart

```python
from kerangka.kir.loader import load_kir
from kerangka.engine.engine import ReferenceEngine

doc = load_kir("app.kir.json")
engine = ReferenceEngine(doc)
print(f"Loaded Kerangka app: {doc['app']}")
```
