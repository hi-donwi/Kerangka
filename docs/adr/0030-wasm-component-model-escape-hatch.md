# ADR-0030: WebAssembly (Wasm) as the Portable Extension Escape Hatch

- **Date:** 2026-09-27
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

Writing host extensions in Java or TypeScript breaks the 'One JSON skeleton. Every stack' promise because the model can no longer run on the other four engines.

## Decision

We adopt WebAssembly (Wasm Component Model) as Kerangka's portable extension mechanism. Custom computational logic compiled to `.wasm` executes identically and sandboxed inside TypeScript, Java, Python, Go, and Dart engines.

## Consequences

### Positive
- Custom logic remains 100% portable across all five language runtimes; sandboxed memory safety.

### Negative
- Requires host engines to embed a WebAssembly runtime (e.g. Wasmtime, Wasmer, V8).

### Neutral
- Host-specific stubs remain supported as the final rung of the escape ladder.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Host language code extensions only | Destroys cross-platform portability as soon as custom logic is introduced. |

## Follow-up

- [x] Recorded in PLAN.md §22
- [ ] Conformance test cases written
- [ ] Tier 1 engine implementations verified
