# Kerangka Go SDK

Specification Version: 0.1
Status: Scaffolding / Draft
License: Apache-2.0

## Overview

The Kerangka Go SDK provides high-performance, idiomatic Go bindings for executing Kerangka models, implementing runtime ports (`Store`, `Bus`, `Cache`), and running pure state transitions.

## Packages

- `pkg/kir`: Intermediate Representation document loader.
- `pkg/ports`: Standard runtime port interfaces for persistence, caching, and event buses.
- `pkg/engine`: Pure in-memory reference execution engine without direct I/O dependencies.
- `pkg/server`: Standard `net/http` REST adapter and server handler with RFC 9457 error support.

## What this engine does not do yet

The expression evaluator covers the comparisons and boolean connectives a guard is written
in (`==`, `!=`, `<`, `<=`, `>`, `>=`, `&&`, `||`, `!`, and field binds). Anything outside that
subset is refused rather than skipped, because skipping would grant what the model forbids
(ADR-0008, ADR-0044):

| Model declares | This SDK |
|---|---|
| A transition guard in the comparison subset | Evaluated. False is `GUARD_FAILED` (422), not a skipped check |
| A transition guard outside that subset (`today()`, `sum`, a call) | `GUARD_UNSUPPORTED`; the server answers 501 |
| A role-map permission with a condition (`"billing": "status == 'draft'"`) | 501 for that caller; roles mapped to `true` and role lists are enforced |
| A `readFilter` | Reads of that entity answer 501 |

Run models that need the rest through the reference engine (`kerangka serve`) until it lands.

## Usage

```go
package main

import (
    "fmt"
    "github.com/hi-donwi/kerangka/sdk/go/pkg/kir"
    "github.com/hi-donwi/kerangka/sdk/go/pkg/engine"
)

func main() {
    doc, err := kir.LoadFile("app.kir.json")
    if err != nil {
        panic(err)
    }

    eng := engine.New(doc)
    fmt.Println("Loaded Kerangka app:", doc.App)
}
```
