# Kerangka Docs Site

Static documentation portal for Kerangka, built with Astro Starlight. The build output
is a plain static site under `dist/`, suitable for any static host.

## Run locally

```bash
npm ci
npm run dev        # http://localhost:4321/docs/preview/
npm run build      # static output under dist/docs/preview
npm run verify     # build, then check every internal link resolves
```

`npm run verify` is the check CI runs. It fails the build if any internal link or asset
in the generated HTML does not resolve.

## Layout

| Path | Purpose |
|---|---|
| `src/content/docs/` | Page sources (MDX, Starlight content collection) |
| `src/content.config.ts` | Content collection schema (`title`, `description`) |
| `astro.config.mjs` | Sidebar, base path, edit links |
| `release.json` | Version, channel, base path, output directory |
| `scripts/check-links.mjs` | Internal link check over the built site |
| `dist/` | Build output (gitignored) |

## Versioned paths

`release.json` decides where the site is published:

```json
{
  "version": "0.1.1",
  "channel": "preview",
  "basePath": "/docs/preview",
  "outDir": "./dist/docs/preview"
}
```

The current channel is **preview**: the site builds to `/docs/preview/` and has no
release guarantees. For a release, `basePath` becomes `/docs/v0.1.1`, `outDir` becomes
`./dist/docs/v0.1.1`, and a `/docs/latest/` alias is created pointing at that version.
Both the versioned path and the alias are decided at release time — see
[RELEASE-CHECKLIST.md](./RELEASE-CHECKLIST.md).

## Related packages

- [`../kitchen-sink`](../kitchen-sink) — preview-only browser demo app that reads
  `../samples/manifest.json`. Separate package: `npm ci`, then `npm run dev`,
  `npm run build`, `npm run test:e2e`.
- `../samples/manifest.json` — sample contract (validated by `../scripts/verify-samples.mjs`).
- `../scripts/generate-samples.mjs` — regenerates OpenAPI, JSON Schema, and UIDL
  projections under `../generated/` (gitignored).

## Source and license attribution

| Component | Version | License |
|---|---|---|
| Astro | 5.18.2 | MIT |
| Starlight (`@astrojs/starlight`) | 0.33.2 | MIT |
| React | 19.3.1 | MIT |
| Vite | 5.4.21 | MIT |
| `uidl-runtime` | 0.1.8 | MIT |
| Playwright | 1.64.1 | Apache-2.0 |

Kerangka itself is Apache-2.0. Content is authored in this repository; no third-party
prose or branding is copied into the site.

## Security limitations

- **Static output only.** The portal has no server component, no database, and no
  authentication; it cannot serve or store private data.
- **Synthetic content.** Sample models, inputs, and expected outcomes are synthetic
  fixtures. No client data belongs in `src/content/docs/` or in `samples/`.
- **No in-browser execution yet.** The kitchen sink renders inputs and expected outcomes;
  live execution in the browser is gated by the C2 review and is not enabled here.
- **Preview channel.** `/docs/preview/` content is not versioned and may change without
  notice; treat `/docs/vX.Y.Z` as the only stable surface once released.
- **No secrets in the build.** CI builds the site without credentials. Do not add tokens,
  private keys, or environment-backed secrets to this package.
