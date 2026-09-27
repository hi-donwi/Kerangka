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
