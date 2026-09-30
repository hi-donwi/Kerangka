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

`scripts/sidecar-smoke.py` runs the whole invoicing workflow this way and is part of CI.

## Quickstart

```python
from kerangka.kir.loader import load_kir
from kerangka.engine.engine import ReferenceEngine

doc = load_kir("app.kir.json")
engine = ReferenceEngine(doc)
print(f"Loaded Kerangka app: {doc['app']}")
```
