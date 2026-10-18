# Docs Release Checklist

Publication requires explicit owner permission. Every step below is preparable without
publishing; the publish step itself waits for the C3 review.

## Gates

| Gate | Scope | State |
|---|---|---|
| C1 | Docs shell, first-model tutorial, sample contract | awaiting owner review |
| C2 | Live execution required: disposable workers, bounded inputs/output, no host I/O, source-only fallback | awaiting owner review |
| C3 | Pre-publication review: attribution, security limitations, versioned paths, artifact | awaiting owner review |

## Checks before a release

Run from the repository root unless a step names another directory.

```bash
# 1. Product
npm run build
npm run typecheck
npm test
npm run test:conformance
npm run examples:verify

# 2. Samples and projections
node scripts/verify-samples.mjs
node scripts/generate-samples.mjs

# 3. Docs site
cd docs-site && npm ci && npm run verify

# 4. Kitchen sink
cd ../kitchen-sink && npm ci && npm run typecheck && npm run build && npm run test:e2e
```

All four groups must be green, and the CI run on the release commit must be green as
well. Record the CI run id in the evidence table below.

## Release steps

1. Confirm the version. Root `package.json` and `docs-site/package.json` must agree with
   the version being released.
2. Edit `docs-site/release.json`:
   - `"channel": "release"`
   - `"basePath": "/docs/v<version>"`
   - `"outDir": "./dist/docs/v<version>"`
3. Run every check above and record the CI run id.
4. Build the artifact: `cd docs-site && npm run verify`. The artifact is
   `docs-site/dist/docs/v<version>/`.
5. Create the `/docs/latest/` alias pointing at the released version. This is decided at
   release time (copy of the built tree or host-level redirect) because the preview
   build must never shadow a released version.
6. **Publish only after C3 approval.** Publishing is a separate, explicitly approved
   action; nothing in this repository publishes on its own.
7. Reset `release.json` to `"channel": "preview"` on `main` if the release branch is
   kept, so daily builds stay on the preview path.

## Evidence

| Item | Value |
|---|---|
| Release version | _(fill at release)_ |
| Release commit | _(fill at release)_ |
| CI run id | _(fill at release)_ |
| Artifact path | `docs-site/dist/docs/v<version>/` |
| C1 review | _(pending)_ |
| C2 review | _(pending)_ |
| C3 review and publish approval | _(pending)_ |

## Known follow-ups

- UIDL-Runtime is retained; UIDL rendering is not part of the engine execution slice.
- Mid-tier mobile TTI measurements and kitchen-sink sample deep links remain open.
- The existing Vite 5 development toolchain audit reports one high and one moderate
  vulnerability. Resolve or explicitly review before C3; no package upgrade or security
  exception is implied by passing the runtime tests.
- The docs dependency audit reports 14 findings, including one critical and one high.
  Triage applicability and remediate before C3; the static build passing is not a clean
  dependency audit.
- `/docs/latest/` alias mechanism.
- Portal coverage: the prose in `docs/reference-applications.md` and
  `docs/usability-protocol.md` is not yet ported into the portal.
- Studio pages: the Studio exists only on an unpushed branch, so no Studio page ships
  with this release.
