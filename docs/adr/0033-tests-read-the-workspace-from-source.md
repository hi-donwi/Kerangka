# ADR-0033: Tests Read the Workspace from Source

- **Date:** 2026-09-30
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

Every package in this workspace declares `main: ./dist/index.js`, and `node_modules/@kerangka/*`
are symlinks into `packages/*`. A test importing `@kerangka/compiler` therefore resolved to
whatever `npm run build` had last produced.

The consequence is a suite that can be green and wrong. Edit the compiler, do not rebuild,
run `npm test`: every assertion runs against a build from before the change. The failure
mode is silence. This repository carried a standing note to rebuild after every compiler
change precisely because the alternative was invisible.

The note was also insufficient. The hazard is not a missing build, it is a *mismatched*
one, and a reminder does not prevent a mismatched build — it only asks people to remember.
It also fails open: nothing detects the omission. During this work the `dist` directories
were moved aside to prove the point, and they reappeared mid-run, rebuilt by another process
sharing the same checkout.

Two tests cannot avoid a build by design. `scripts/sidecar-smoke.py` is the L1 claim for a
language that embeds no Kerangka engine, and it drives the built CLI as a separate process.
The cross-process session tests spawn a child that opens the built store, because proving a
file lock works across a process boundary requires a second process. Neither can import
TypeScript.

## Decision

A workspace import means the source, for the tools that check the code:

- `vitest.config.ts` aliases every `@kerangka/*` import to `packages/*/src`. The list is
  generated from the packages directory, so a new package cannot be left unmapped.
  `@kerangka/ports/test-kits` is matched by a more specific rule placed first, because a
  prefix match on `@kerangka/ports` would resolve the subpath to a file that does not exist.
- `tsconfig.json` maps the same way, for `npm run typecheck` and the editor, so a type error
  introduced in the source is caught without a build and go-to-definition lands in the source.

The build is deliberately left resolving to `dist`. The package build configs extend
`tsconfig.base.json`, which carries no `paths`; only the root config does. A test in
`test/workspace-resolution.test.ts` asserts that this stays true, that every package is
mapped in both places, and that no alias swallows a subpath — so the mapping cannot be
removed by a tidy-up that does not know what it was for.

CI builds before the test step rather than teaching the two out-of-process tests to do
without a build. Their value is that they leave the process.

## Consequences

### Positive

- A test cannot pass against a build from before the change. The failure mode is gone, not
  documented.
- `npm test` and `npm run typecheck` work on a clean checkout, where no `dist` exists.
- The inner loop needs no build, so the build is paid once per gate instead of per edit.

### Negative

- Two mechanisms now describe the workspace: the alias list in `vitest.config.ts` and the
  `paths` map in `tsconfig.json`. The guard test is what keeps them in agreement, and it
  is a test rather than a compiler setting, so it can itself be deleted.
- Type checking and the build now read different files. That is the point, but it means a
  `tsc` error in a package the tests do not import surfaces only at build time.

### Neutral

- Anything that runs the *built* CLI directly — `npm run examples:verify`, or
  `scripts/sidecar-smoke.py` by hand — still tests the build, and a stale build there is
  still possible. CI builds immediately before `examples:verify`, so CI is covered; a local
  run is the developer's responsibility. This is stated rather than closed.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Require `npm run build` before `npm test` | Still passes against a stale build, which is the actual hazard, and makes the inner loop slower. |
| Check that `dist` is newer than `src` before testing | Encodes a second opinion about what should have been built; wrong the moment a comment changes, and it cannot detect a build made from different source. |
| Publish packages and test the published artifacts | Tests something no contributor runs, and a local build would still shadow it. |
| Drop the out-of-process tests so nothing needs a build | The Python smoke is the L1 claim for a non-Kerangka language, and the cross-process tests are the only proof the session claim works between processes. |

## Follow-up

- [x] Recorded in `CONTRIBUTING.md`
- [x] Guard test in `test/workspace-resolution.test.ts`
- [ ] A `--source` mode for `scripts/verify-examples.mjs`, so a local examples run cannot
      verify against a stale compiler
