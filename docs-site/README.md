# Kerangka Docs Site

Static documentation portal for Kerangka, built with Astro Starlight. The build output
is a plain static site under `dist/`, suitable for any static host.

## Run locally

The portal requires **Node.js 22.22.0 or newer**, as required by Astro 7. This is separate
from the core CLI's runtime requirements. CI selects the latest Node 22 patch.

```bash
npm ci
npm run audit:security
npm run dev        # http://localhost:4321/Kerangka/docs/v0.1.1/
npm run build      # static output under dist/Kerangka/docs/v0.1.1
npm run verify     # build, then check every internal link resolves
npx playwright install chromium --only-shell
npm run test:e2e    # built-site content, desktop/mobile navigation, and Pagefind search
```

`npm run verify` is the check CI runs. It fails the build if any internal anchor link
in the generated HTML does not resolve.

CI also runs `audit:security` and the browser tests. The audit explicitly includes
development dependencies and fails on high/critical findings or scanner errors.

## Layout

| Path | Purpose |
|---|---|
| `src/content/docs/` | Page sources (MDX, Starlight content collection) |
| `src/content.config.ts` | Starlight docs loader and collection schema |
| `astro.config.mjs` | Sidebar, base path, edit links |
| `release.json` | Version, channel, base path, output directory |
| `scripts/check-links.mjs` | Internal link check over the built site |
| `e2e/` | Production-build browser smoke tests |
| `dist/` | Build output (gitignored) |

## Versioned paths

`release.json` decides where the site is published:

```json
{
  "version": "0.1.1",
  "channel": "release",
  "basePath": "/Kerangka/docs/v0.1.1",
  "outDir": "./dist/Kerangka/docs/v0.1.1"
}
```

The current channel is **release** `v0.1.1`. GitHub project Pages serves the
repository at `/Kerangka/`, so the public path is `/Kerangka/docs/v0.1.1/`.
A `/Kerangka/docs/latest/` alias is created at publish time and must point at that version.
Preview builds use `/docs/preview/` and must not shadow a released version. See
[RELEASE-CHECKLIST.md](./RELEASE-CHECKLIST.md).

## Related packages

- [`../kitchen-sink`](../kitchen-sink) — bounded browser execution app that reads
  `../samples/manifest.json`. See its [setup instructions](../kitchen-sink/README.md) for
  the root workspace build prerequisite and standalone package commands.
- `../samples/manifest.json` — sample contract (validated by `../scripts/verify-samples.mjs`).
- `../scripts/generate-samples.mjs` — regenerates KIR, OpenAPI, JSON Schema, and UIDL
  projections under `../generated/` (gitignored).

## Source and license attribution

| Component | Version | License |
|---|---|---|
| Astro | 7.4.0 | MIT |
| Starlight (`@astrojs/starlight`) | 0.42.6 | MIT |
| Markdown (`@astrojs/markdown-remark`) | 7.3.3 | MIT |
| React | 19.3.1 | MIT |
| Vite (portal toolchain) | 8.3.4 | MIT |
| Vite (kitchen sink) | 6.4.4 | MIT |
| `uidl-runtime` | 0.1.12 | MIT |
| Playwright | 1.64.1 | Apache-2.0 |

Kerangka itself is Apache-2.0. Content is authored in this repository; no third-party
prose or branding is copied into the site.

## Dependency maintenance

Astro 7.4 and Starlight 0.42 replace the vulnerable Astro 5 toolchain. The content
configuration now uses the documented `docsLoader()` API rather than legacy collection
compatibility. The Markdown processor peer is declared explicitly.

On 2026-10-18, the portal's complete npm audit reports **no high/critical findings**,
down from one of each. Re-checked on 2026-10-20, it still reports ten moderate findings
along the single Expressive Code 0.44.2 / `postcss-nested` 6.2.0 /
`postcss-selector-parser` 6.1.4 chain
([GHSA-rj75-hqrm-r3gf](https://github.com/advisories/GHSA-rj75-hqrm-r3gf)). The fixed
parser is 7.1.6+. The installed `postcss-nested` range is `^6.1.1`, and the only
`npm audit` fix path downgrades Starlight to 0.21.5, a semver-major move that would
undo the Astro 7 upgrade. No cross-major override, downgrade, or security exception
is applied.

`audit:security` is a high/critical gate, not a claim that the complete audit has no
findings. Use `npm audit --include=dev --json` to inspect all severities, and preserve
lockfile integrity when refreshing dependencies.

Migration references: [Astro 6](https://docs.astro.build/en/guides/upgrade-to/v6/),
[Astro 7](https://docs.astro.build/en/guides/upgrade-to/v7/), and
[Starlight collections](https://starlight.astro.build/manual-setup/#configure-content-collections).

## Security limitations

- **Static output only.** The portal has no server component, no database, and no
  authentication; it cannot serve or store private data.
- **Synthetic content.** Sample models, inputs, and expected outcomes are synthetic
  fixtures. No client data belongs in `src/content/docs/` or in `samples/`.
- **Separate browser execution.** The kitchen sink runs shipped fixtures in bounded
  disposable workers. Effects remain data and are never dispatched or persisted;
  C2 acceptance is still an owner decision. The portal itself does not execute models.
- **Preview channel.** `/docs/preview/` content is not versioned and may change without
  notice; treat `/docs/vX.Y.Z` as the only stable surface once released.
- **No secrets in the build.** CI builds the site without credentials. Do not add tokens,
  private keys, or environment-backed secrets to this package.
