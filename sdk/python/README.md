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

## Quickstart

```python
from kerangka.kir.loader import load_kir
from kerangka.engine.engine import ReferenceEngine

doc = load_kir("app.kir.json")
engine = ReferenceEngine(doc)
print(f"Loaded Kerangka app: {doc['app']}")
```
